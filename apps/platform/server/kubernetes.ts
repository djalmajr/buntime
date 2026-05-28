/**
 * Per-tenant Ingress provisioning via the Kubernetes API.
 *
 * The platform runs single-pod in ns `platform` and exposes traffic through a
 * single Ingress (`buntime-platform`) whose rules and TLS hosts list grow as
 * tenants are created. We do not create one Ingress per tenant — we patch the
 * existing one — so cert-manager keeps issuing a single SAN cert and Traefik
 * sees one merged config.
 *
 * Auth: in-cluster service-account token + CA from
 * `/var/run/secrets/kubernetes.io/serviceaccount/`. The RBAC needed is the
 * minimum to read/update one Ingress: see `infra/platform/rbac.yaml`.
 *
 * `fetch` and the in-cluster paths are injectable for tests.
 */

import { readFileSync } from "node:fs";
import { ValidationError } from "@buntime/shared/errors";

export interface KubernetesOptions {
  /** API server base URL. Default: `https://kubernetes.default.svc`. */
  baseUrl?: string;
  /** SA token. Default: read from `tokenPath`. */
  token?: string;
  /**
   * Service-account token path (in-cluster). Default:
   * `/var/run/secrets/kubernetes.io/serviceaccount/token`.
   */
  tokenPath?: string;
  /** Target namespace for the Ingress (`platform`). */
  namespace: string;
  /** Ingress resource name (single shared Ingress). */
  ingressName: string;
  /** Backend Service name. */
  serviceName: string;
  /** Backend Service port (number). */
  servicePort: number;
  /** TLS secret name (the merged SAN cert). */
  tlsSecretName: string;
  /** Optional ingressClassName override (e.g. `traefik`). */
  ingressClassName?: string;
  /** cert-manager.io/cluster-issuer annotation value (e.g. `selfsigned-issuer`). */
  clusterIssuer?: string;
  fetch?: typeof fetch;
}

interface IngressBackend {
  service: { name: string; port: { number: number } };
}

interface IngressPath {
  path: string;
  pathType: "Prefix" | "Exact" | "ImplementationSpecific";
  backend: IngressBackend;
}

interface IngressRule {
  host: string;
  http: { paths: IngressPath[] };
}

interface IngressTls {
  hosts: string[];
  secretName: string;
}

interface IngressSpec {
  ingressClassName?: string;
  rules?: IngressRule[];
  tls?: IngressTls[];
}

interface Ingress {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace: string; annotations?: Record<string, string> };
  spec: IngressSpec;
}

/** Subset of {@link KubernetesIngressClient} used by the provisioner. */
export interface KubernetesLike {
  addIngressHost(host: string): Promise<void>;
  removeIngressHost(host: string): Promise<void>;
}

export class KubernetesIngressClient implements KubernetesLike {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchFn: typeof fetch;
  private readonly namespace: string;
  private readonly ingressName: string;
  private readonly serviceName: string;
  private readonly servicePort: number;
  private readonly tlsSecretName: string;
  private readonly ingressClassName?: string;
  private readonly clusterIssuer?: string;

  constructor(opts: KubernetesOptions) {
    this.baseUrl = (opts.baseUrl ?? "https://kubernetes.default.svc").replace(/\/$/, "");
    this.fetchFn = opts.fetch ?? fetch;
    this.namespace = opts.namespace;
    this.ingressName = opts.ingressName;
    this.serviceName = opts.serviceName;
    this.servicePort = opts.servicePort;
    this.tlsSecretName = opts.tlsSecretName;
    this.ingressClassName = opts.ingressClassName;
    this.clusterIssuer = opts.clusterIssuer;

    if (opts.token) {
      this.token = opts.token;
    } else {
      const path = opts.tokenPath ?? "/var/run/secrets/kubernetes.io/serviceaccount/token";
      try {
        this.token = readFileSync(path, "utf8").trim();
      } catch (err) {
        throw new ValidationError(
          `Kubernetes SA token not readable at ${path}: ${(err as Error).message}`,
          "K8S_TOKEN_MISSING",
        );
      }
    }
  }

  private ingressPath(): string {
    return `/apis/networking.k8s.io/v1/namespaces/${encodeURIComponent(this.namespace)}/ingresses/${encodeURIComponent(this.ingressName)}`;
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type":
          init?.method === "PATCH" ? "application/merge-patch+json" : "application/json",
        Accept: "application/json",
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ValidationError(
        `Kubernetes API ${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`,
        "K8S_API_FAILED",
      );
    }
    return (await res.json()) as T;
  }

  private buildRule(host: string): IngressRule {
    return {
      host,
      http: {
        paths: [
          {
            path: "/",
            pathType: "Prefix",
            backend: {
              service: { name: this.serviceName, port: { number: this.servicePort } },
            },
          },
        ],
      },
    };
  }

  /**
   * Add (idempotently) a rule + TLS host to the platform Ingress. If the
   * Ingress does not exist yet (first tenant), create it.
   */
  async addIngressHost(host: string): Promise<void> {
    const lower = host.toLowerCase();
    let ingress: Ingress | null = null;
    try {
      ingress = await this.api<Ingress>(this.ingressPath());
    } catch (err) {
      if (!(err instanceof ValidationError) || !err.message.includes(" 404 ")) {
        throw err;
      }
    }

    if (!ingress) {
      const created: Ingress = {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: {
          name: this.ingressName,
          namespace: this.namespace,
          ...(this.clusterIssuer && {
            annotations: { "cert-manager.io/cluster-issuer": this.clusterIssuer },
          }),
        },
        spec: {
          ...(this.ingressClassName && { ingressClassName: this.ingressClassName }),
          rules: [this.buildRule(lower)],
          tls: [{ hosts: [lower], secretName: this.tlsSecretName }],
        },
      };
      await this.api(
        `/apis/networking.k8s.io/v1/namespaces/${encodeURIComponent(this.namespace)}/ingresses`,
        { method: "POST", body: JSON.stringify(created) },
      );
      return;
    }

    const rules = ingress.spec.rules ?? [];
    const tls = ingress.spec.tls ?? [];
    const hasRule = rules.some((r) => r.host?.toLowerCase() === lower);
    const tlsEntry = tls[0];
    const tlsHosts = tlsEntry?.hosts ?? [];
    const hasTls = tlsHosts.some((h) => h.toLowerCase() === lower);
    if (hasRule && hasTls) return;

    const nextRules = hasRule ? rules : [...rules, this.buildRule(lower)];
    const nextTls: IngressTls[] = hasTls
      ? tls
      : tlsEntry
        ? [{ hosts: [...tlsHosts, lower], secretName: tlsEntry.secretName }, ...tls.slice(1)]
        : [{ hosts: [lower], secretName: this.tlsSecretName }];

    await this.api(this.ingressPath(), {
      method: "PATCH",
      body: JSON.stringify({ spec: { rules: nextRules, tls: nextTls } }),
    });
  }

  /** Remove the rule + TLS host (best-effort; missing ingress is treated as ok). */
  async removeIngressHost(host: string): Promise<void> {
    const lower = host.toLowerCase();
    let ingress: Ingress;
    try {
      ingress = await this.api<Ingress>(this.ingressPath());
    } catch (err) {
      if (err instanceof ValidationError && err.message.includes(" 404 ")) return;
      throw err;
    }

    const rules = (ingress.spec.rules ?? []).filter((r) => r.host?.toLowerCase() !== lower);
    const tlsEntry = ingress.spec.tls?.[0];
    const nextTls: IngressTls[] | undefined = tlsEntry
      ? [
          {
            hosts: tlsEntry.hosts.filter((h) => h.toLowerCase() !== lower),
            secretName: tlsEntry.secretName,
          },
          ...(ingress.spec.tls?.slice(1) ?? []),
        ]
      : ingress.spec.tls;

    await this.api(this.ingressPath(), {
      method: "PATCH",
      body: JSON.stringify({ spec: { rules, tls: nextTls } }),
    });
  }
}
