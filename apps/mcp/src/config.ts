import { ValidationError } from "@buntime/shared/errors";

/**
 * Resolved configuration for the Buntime MCP server. The server is a thin,
 * local stdio client that forwards an API key to a remote Buntime runtime; the
 * runtime enforces the key's role and namespaces server-side.
 */
export interface McpConfig {
  /** Runtime base URL without a trailing slash, e.g. `https://buntime.example.com`. */
  baseUrl: string;
  /** API key sent as `X-API-Key`. Root key or a generated `btk_*` key. */
  apiKey: string;
  /** `Origin` header value; defaults to the base URL origin (satisfies CSRF on any surface). */
  origin: string;
  /** Optional explicit API path (e.g. `/_/api`). When unset, it is discovered from `/.well-known/buntime`. */
  apiPath?: string;
  /** Base path of the gateway plugin admin API (default `/gateway`). */
  gatewayBase: string;
  /** Base path of the proxy plugin admin API (default `/redirects`). */
  proxyBase: string;
}

type Env = Record<string, string | undefined>;

/**
 * Build the config from environment variables. `BUNTIME_URL` and
 * `BUNTIME_API_KEY` are required; `BUNTIME_ORIGIN` and `BUNTIME_API_PATH` are
 * optional overrides.
 */
export function loadConfig(env: Env = Bun.env): McpConfig {
  const baseUrlRaw = env.BUNTIME_URL?.trim();
  const apiKey = env.BUNTIME_API_KEY?.trim();

  if (!baseUrlRaw) {
    throw new ValidationError(
      "BUNTIME_URL environment variable is required",
      "MISSING_BUNTIME_URL",
    );
  }
  if (!apiKey) {
    throw new ValidationError(
      "BUNTIME_API_KEY environment variable is required",
      "MISSING_BUNTIME_API_KEY",
    );
  }

  const baseUrl = baseUrlRaw.replace(/\/+$/, "");

  let origin = env.BUNTIME_ORIGIN?.trim();
  if (!origin) {
    try {
      origin = new URL(baseUrl).origin;
    } catch {
      throw new ValidationError(`Invalid BUNTIME_URL: ${baseUrlRaw}`, "INVALID_BUNTIME_URL");
    }
  }

  const apiPath = env.BUNTIME_API_PATH?.trim() || undefined;
  const gatewayBase = env.BUNTIME_GATEWAY_BASE?.trim()?.replace(/\/+$/, "") || "/gateway";
  const proxyBase = env.BUNTIME_PROXY_BASE?.trim()?.replace(/\/+$/, "") || "/redirects";

  return { baseUrl, apiKey, origin, apiPath, gatewayBase, proxyBase };
}
