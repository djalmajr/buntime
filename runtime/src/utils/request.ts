/**
 * Request utilities for body cloning and URL rewriting
 */
import { getConfig } from "@/config";
import { Headers } from "@/constants";

/**
 * Error thrown when request body exceeds size limit
 */
export class BodyTooLargeError extends Error {
  constructor(size: number, maxSize: number) {
    super(`Request body too large: ${size} bytes (max: ${maxSize})`);
    this.name = "BodyTooLargeError";
  }
}

/**
 * Clone request body to ArrayBuffer with size limit
 * Security: Prevents DoS attacks via large request bodies
 *
 * @param req - Request to clone body from
 * @param maxSizeBytes - Maximum allowed body size (defaults to runtime config)
 * @throws {BodyTooLargeError} if body exceeds maxSizeBytes
 */
export async function cloneRequestBody(
  req: Request,
  maxSizeBytes?: number,
): Promise<ArrayBuffer | null> {
  const limit = maxSizeBytes ?? getConfig().bodySize.default;
  if (!req.body) return null;

  // Check Content-Length header first (fast path)
  // Security: Validate size is a finite positive integer to prevent overflow attacks
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (Number.isNaN(size) || !Number.isFinite(size) || size < 0) {
      throw new BodyTooLargeError(0, limit); // Invalid Content-Length
    }
    if (size > limit) {
      throw new BodyTooLargeError(size, limit);
    }
  }

  const body = await Bun.readableStreamToArrayBuffer(req.clone().body!);

  // Verify actual size (for chunked encoding or missing Content-Length)
  if (body.byteLength > limit) {
    throw new BodyTooLargeError(body.byteLength, limit);
  }

  return body;
}

/**
 * Rewrite URL by removing base path and preserving query string
 * @param url - Original URL
 * @param basePath - Base path to strip (e.g., "/api/plugins")
 * @returns New URL with path relative to base
 */
export function rewriteUrl(url: URL, basePath: string): URL {
  const relativePath = basePath ? url.pathname.slice(basePath.length) || "/" : url.pathname;
  return new URL(relativePath + url.search, url.origin);
}

export interface WorkerRequestOptions {
  /** Base path for asset loading */
  base: string;
  /** Fragment route for app-shell mode */
  fragmentRoute?: string;
  /** Indicates 404 should be rendered by shell */
  notFound?: boolean;
  /** Original request to clone headers/method from */
  originalRequest: Request;
  /** Target path for the worker */
  targetPath: string;
}

/**
 * Create a new request for worker with proper headers
 * Consolidates repeated request creation patterns across handlers
 */
export function createWorkerRequest({
  base,
  fragmentRoute,
  notFound,
  originalRequest,
  targetPath,
}: WorkerRequestOptions): Request {
  const url = new URL(originalRequest.url);
  const newUrl = new URL(targetPath + url.search, url.origin);

  const req = new Request(newUrl.href, originalRequest);
  req.headers.set(Headers.BASE, base);

  if (fragmentRoute) req.headers.set(Headers.FRAGMENT_ROUTE, fragmentRoute);
  if (notFound) req.headers.set(Headers.NOT_FOUND, "true");

  return req;
}
