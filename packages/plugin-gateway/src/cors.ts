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
  const requestMethod = req.headers.get("Access-Control-Request-Method");
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
