import type { PublicRoutesConfig } from "@buntime/shared/types";

/**
 * Extracts public routes for a specific HTTP method from the configuration.
 *
 * Handles both array and object formats:
 * - Array format: Returns routes for ALL methods
 * - Object format: Combines ALL routes with method-specific routes
 *
 * @param publicRoutes - The public routes configuration
 * @param method - HTTP method (GET, POST, DELETE, etc.)
 * @returns Array of route patterns for the given method
 *
 * @example
 * // Array format (ALL methods)
 * getPublicRoutesForMethod(["/api/health"], "GET")  // ["/api/health"]
 * getPublicRoutesForMethod(["/api/health"], "POST") // ["/api/health"]
 *
 * @example
 * // Object format
 * const config = {
 *   ALL: ["/api/health"],
 *   GET: ["/api/users"],
 *   POST: ["/api/webhook"]
 * };
 * getPublicRoutesForMethod(config, "GET")  // ["/api/health", "/api/users"]
 * getPublicRoutesForMethod(config, "POST") // ["/api/health", "/api/webhook"]
 */
export function getPublicRoutesForMethod(
  publicRoutes: PublicRoutesConfig | undefined,
  method: string,
): string[] {
  if (!publicRoutes) return [];

  // Array format: applies to ALL methods
  if (Array.isArray(publicRoutes)) {
    return publicRoutes;
  }

  // Object format: combine ALL + method-specific routes
  const normalizedMethod = method.toUpperCase() as keyof typeof publicRoutes;
  const allRoutes = publicRoutes.ALL || [];
  const methodRoutes = publicRoutes[normalizedMethod] || [];

  // Combine and deduplicate
  return [...new Set([...allRoutes, ...methodRoutes])];
}
