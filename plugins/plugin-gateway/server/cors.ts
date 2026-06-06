/**
 * CORS Configuration
 */
export interface CorsConfig {
  /**
   * Allowed origins
   * - "*" allows all origins
   * - Array of specific origins
   * - Function for dynamic origin checking
   */
  origin?: string | string[] | ((origin: string) => boolean);

  /**
   * Allowed HTTP methods
   * @default ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"]
   */
  methods?: string[];

  /**
   * Allowed headers
   * @default Reflects Access-Control-Request-Headers
   */
  allowedHeaders?: string[];

  /**
   * Exposed headers (accessible to client)
   */
  exposedHeaders?: string[];

  /**
   * Allow credentials (cookies, authorization headers)
   * @default false
   */
  credentials?: boolean;

  /**
   * Max age for preflight cache (seconds)
   * @default 86400 (24 hours)
   */
  maxAge?: number;

  /**
   * Handle preflight requests automatically
   * @default true
   */
  preflight?: boolean;
}

const DEFAULT_METHODS = ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"];

/**
 * A named, per-domain CORS rule. Each rule declares which origins it applies
 * to and the policy granted to them. Requests are matched against the rule
 * whose `origins` cover the request's Origin; unmatched origins get no CORS
 * headers (deny by default). An explicit `"*"` origin acts as a catch-all.
 */
export interface CorsRule {
  /** Stable identifier */
  id: string;
  /** Human-friendly label shown in the UI */
  name: string;
  /** Origins this rule applies to: exact ("https://app.x.com"), subdomain wildcard ("*.x.com"), or "*" */
  origins: string[];
  /** Allowed HTTP methods */
  methods?: string[];
  /** Allowed request headers (empty reflects Access-Control-Request-Headers) */
  allowedHeaders?: string[];
  /** Headers exposed to the browser */
  exposedHeaders?: string[];
  /** Allow credentials (cookies/auth). Cannot combine with a "*" origin. */
  credentials?: boolean;
  /** Preflight cache duration (seconds) */
  maxAge?: number;
  /** When the rule was created */
  createdAt?: number;
}

/**
 * Check whether a request Origin matches a single origin pattern.
 * Supports exact match, subdomain wildcard (`*.example.com`), and `*`.
 */
export function originMatchesPattern(origin: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern === origin) return true;

  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // ".example.com"
    let host = origin;
    try {
      host = new URL(origin).host;
    } catch {
      // origin is not a full URL; fall back to suffix match on the raw value
    }
    return host.endsWith(suffix);
  }

  return false;
}

/**
 * Find the rule that applies to a request Origin. Specific (non-`*`) matches
 * win over a catch-all `"*"` rule.
 */
export function matchCorsRule(origin: string, rules: CorsRule[]): CorsRule | null {
  let wildcard: CorsRule | null = null;

  for (const rule of rules) {
    for (const pattern of rule.origins) {
      if (pattern === "*") {
        wildcard ??= rule;
        continue;
      }
      if (originMatchesPattern(origin, pattern)) {
        return rule;
      }
    }
  }

  return wildcard;
}

/**
 * Resolve the effective single-origin CorsConfig for a request from the rule
 * list, or `null` when the origin is absent or unmatched (deny by default).
 * The returned config feeds the existing header builders.
 */
export function resolveCors(req: Request, rules: CorsRule[]): CorsConfig | null {
  const origin = req.headers.get("Origin");
  if (!origin || rules.length === 0) return null;

  const rule = matchCorsRule(origin, rules);
  if (!rule) return null;

  const isWildcard = rule.origins.includes("*");
  const credentials = rule.credentials ?? false;

  return {
    // Reflect the specific origin unless this is a wildcard rule without
    // credentials (where a literal "*" is valid and cache-friendly).
    origin: isWildcard && !credentials ? "*" : origin,
    methods: rule.methods,
    allowedHeaders: rule.allowedHeaders,
    exposedHeaders: rule.exposedHeaders,
    credentials,
    maxAge: rule.maxAge,
    preflight: rule.origins.length > 0,
  };
}

/**
 * Check if origin is allowed
 */
function isOriginAllowed(origin: string, config: CorsConfig): boolean {
  if (!config.origin) return false;

  if (config.origin === "*") return true;

  if (typeof config.origin === "function") {
    return config.origin(origin);
  }

  if (Array.isArray(config.origin)) {
    return config.origin.includes(origin);
  }

  return config.origin === origin;
}

/**
 * Build CORS headers for response
 */
export function buildCorsHeaders(req: Request, config: CorsConfig): Headers {
  const headers = new Headers();
  const origin = req.headers.get("Origin");

  if (!origin) {
    return headers;
  }

  // Check if origin is allowed
  if (!isOriginAllowed(origin, config)) {
    return headers;
  }

  // Access-Control-Allow-Origin
  if (config.origin === "*" && !config.credentials) {
    headers.set("Access-Control-Allow-Origin", "*");
  } else {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.append("Vary", "Origin");
  }

  // Access-Control-Allow-Credentials
  if (config.credentials) {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  // Access-Control-Expose-Headers
  if (config.exposedHeaders?.length) {
    headers.set("Access-Control-Expose-Headers", config.exposedHeaders.join(", "));
  }

  return headers;
}

/**
 * Build preflight response headers
 */
export function buildPreflightHeaders(req: Request, config: CorsConfig): Headers {
  const headers = buildCorsHeaders(req, config);
  const requestHeaders = req.headers.get("Access-Control-Request-Headers");

  // Access-Control-Allow-Methods
  const methods = config.methods ?? DEFAULT_METHODS;
  headers.set("Access-Control-Allow-Methods", methods.join(", "));

  // Access-Control-Allow-Headers
  if (config.allowedHeaders?.length) {
    headers.set("Access-Control-Allow-Headers", config.allowedHeaders.join(", "));
  } else if (requestHeaders) {
    // Reflect requested headers
    headers.set("Access-Control-Allow-Headers", requestHeaders);
    headers.append("Vary", "Access-Control-Request-Headers");
  }

  // Access-Control-Max-Age
  const maxAge = config.maxAge ?? 86400;
  headers.set("Access-Control-Max-Age", maxAge.toString());

  return headers;
}

/**
 * Handle CORS preflight request
 */
export function handlePreflight(req: Request, config: CorsConfig): Response | null {
  if (req.method !== "OPTIONS") {
    return null;
  }

  const requestMethod = req.headers.get("Access-Control-Request-Method");
  if (!requestMethod) {
    return null; // Not a preflight request
  }

  const headers = buildPreflightHeaders(req, config);

  return new Response(null, {
    status: 204,
    headers,
  });
}

/**
 * Add CORS headers to response
 */
export function addCorsHeaders(req: Request, res: Response, config: CorsConfig): Response {
  const corsHeaders = buildCorsHeaders(req, config);

  if (corsHeaders.entries().next().done) {
    // No CORS headers to add
    return res;
  }

  const newHeaders = new Headers(res.headers);
  corsHeaders.forEach((value, key) => {
    newHeaders.append(key, value);
  });

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: newHeaders,
  });
}
