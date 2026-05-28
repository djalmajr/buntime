/**
 * Cloudflare Tunnel + DNS automation for tenant hostnames.
 *
 * `addHostname(host)` appends an ingress rule (`<host> → https://localhost:443`,
 * `noTLSVerify`) before the tunnel's catch-all and creates a proxied CNAME
 * `<host> → <tunnelId>.cfargotunnel.com`. Idempotent. Mirrors what
 * `infra/scripts/setup-cloudflare-tunnel.sh` does via the API.
 *
 * `fetch` is injectable for tests.
 */

import { ValidationError } from "@buntime/shared/errors";

const API_BASE = "https://api.cloudflare.com/client/v4";
const DEFAULT_SERVICE = "https://localhost:443";

export interface CloudflareOptions {
  apiToken: string;
  accountId: string;
  tunnelId: string;
  zoneId: string;
  /** Origin service for the ingress rule. Default `https://localhost:443`. */
  service?: string;
  fetch?: typeof fetch;
}

interface IngressRule {
  hostname?: string;
  service: string;
  originRequest?: { noTLSVerify?: boolean };
}

interface TunnelConfig {
  ingress: IngressRule[];
  [key: string]: unknown;
}

export class CloudflareTunnel {
  private readonly opts: Required<Omit<CloudflareOptions, "fetch">>;
  private readonly fetchFn: typeof fetch;

  constructor(opts: CloudflareOptions) {
    this.opts = {
      apiToken: opts.apiToken,
      accountId: opts.accountId,
      tunnelId: opts.tunnelId,
      zoneId: opts.zoneId,
      service: opts.service ?? DEFAULT_SERVICE,
    };
    this.fetchFn = opts.fetch ?? fetch;
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchFn(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.opts.apiToken}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    const body = (await res.json()) as { success: boolean; result: T; errors?: unknown[] };
    if (!res.ok || !body.success) {
      throw new ValidationError(
        `Cloudflare API ${path} failed: ${res.status} ${JSON.stringify(body.errors ?? [])}`,
        "CLOUDFLARE_API_FAILED",
      );
    }
    return body.result;
  }

  private get cname(): string {
    return `${this.opts.tunnelId}.cfargotunnel.com`;
  }

  private configPath(): string {
    return `/accounts/${this.opts.accountId}/cfd_tunnel/${this.opts.tunnelId}/configurations`;
  }

  /** Add (idempotently) the tunnel ingress rule + DNS CNAME for `host`. */
  async addHostname(host: string): Promise<void> {
    const current = await this.api<{ config: TunnelConfig }>(this.configPath());
    const ingress = current.config?.ingress ?? [{ service: "http_status:404" }];

    if (!ingress.some((r) => r.hostname === host)) {
      const rule: IngressRule = {
        hostname: host,
        service: this.opts.service,
        originRequest: { noTLSVerify: true },
      };
      // Insert before the catch-all (last rule has no hostname).
      const catchAllIndex = ingress.findIndex((r) => !r.hostname);
      const insertAt = catchAllIndex === -1 ? ingress.length : catchAllIndex;
      ingress.splice(insertAt, 0, rule);

      await this.api(this.configPath(), {
        method: "PUT",
        body: JSON.stringify({ config: { ...current.config, ingress } }),
      });
    }

    await this.ensureDns(host);
  }

  /** Remove the ingress rule + DNS CNAME for `host` (best-effort). */
  async removeHostname(host: string): Promise<void> {
    const current = await this.api<{ config: TunnelConfig }>(this.configPath());
    const ingress = (current.config?.ingress ?? []).filter((r) => r.hostname !== host);
    await this.api(this.configPath(), {
      method: "PUT",
      body: JSON.stringify({ config: { ...current.config, ingress } }),
    });

    const records = await this.api<Array<{ id: string }>>(
      `/zones/${this.opts.zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(host)}`,
    );
    for (const record of records) {
      await this.api(`/zones/${this.opts.zoneId}/dns_records/${record.id}`, { method: "DELETE" });
    }
  }

  private async ensureDns(host: string): Promise<void> {
    const existing = await this.api<Array<{ id: string }>>(
      `/zones/${this.opts.zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(host)}`,
    );
    if (existing.length > 0) return;

    await this.api(`/zones/${this.opts.zoneId}/dns_records`, {
      method: "POST",
      body: JSON.stringify({
        type: "CNAME",
        name: host,
        content: this.cname,
        proxied: true,
      }),
    });
  }
}
