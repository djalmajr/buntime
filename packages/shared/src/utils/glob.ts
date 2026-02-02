/**
 * @fileoverview Glob pattern matching utilities
 *
 * Provides functions to convert glob patterns to regular expressions
 * for route matching in plugins.
 */

import type { PublicRoutesConfig } from "../types/plugin";

/**
 * Convert a glob pattern to a regex pattern string
 *
 * Supports:
 * - `*` - matches any characters except `/`
 * - `**` - matches any characters including `/` (recursive)
 * - `?` - matches a single character
 *
 * @param pattern - Glob pattern (e.g., "/api/**", "/config/*")
 * @returns Regex pattern string
 *
 * @example
 * globToRegex("/api/*")     // "^/api/[^/]*$"
 * globToRegex("/api/**")    // "^/api/.*$"
 * globToRegex("/v?/test")   // "^/v./test$"
 */
export function globToRegex(pattern: string): string {
  // If pattern is already a regex (starts with `(`), return as-is
  if (pattern.startsWith("(")) return pattern;

  let regex = pattern
    // Escape regex special characters (except * and ?)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    // Replace ** with placeholder (to avoid double replacement)
    .replace(/\*\*/g, "___DOUBLE_STAR___")
    // Replace * with "any characters except /"
    .replace(/\*/g, "[^/]*")
    // Replace placeholder with "any characters including /"
    .replace(/___DOUBLE_STAR___/g, ".*")
    // Replace ? with "any single character"
    .replace(/\?/g, ".");

  // Ensure pattern matches from start
  if (!regex.startsWith("^")) regex = `^${regex}`;
  // Ensure pattern matches to end
  if (!regex.endsWith("$")) regex = `${regex}$`;

  return regex;
}

/**
 * Convert an array of glob patterns to a combined RegExp
 *
 * @param patterns - Array of glob patterns
 * @returns Combined RegExp or null if patterns is empty
 *
 * @example
 * globArrayToRegex(["/api/*", "/health"])
 * // Returns: /(^\/api\/[^\/]*$|^\/health$)/
 */
export function globArrayToRegex(patterns: string[]): RegExp | null {
  if (!patterns?.length) return null;
  return new RegExp(`(${patterns.map(globToRegex).join("|")})`);
}

/**
 * Get public routes for a specific HTTP method from a PublicRoutesConfig
 *
 * Handles two configuration formats:
 * - Array format: applies to ALL methods
 * - Object format: combines ALL + method-specific routes
 *
 * @param publicRoutes - Public routes configuration
 * @param method - HTTP method (GET, POST, etc.)
 * @returns Array of public route patterns
 *
 * @example
 * // Array format - applies to all methods
 * getPublicRoutesForMethod(["/health", "/api/public/**"], "GET")
 * // Returns: ["/health", "/api/public/**"]
 *
 * // Object format
 * getPublicRoutesForMethod({
 *   ALL: ["/health"],
 *   GET: ["/api/docs"],
 *   POST: ["/api/auth/login"]
 * }, "GET")
 * // Returns: ["/health", "/api/docs"]
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

  // Object format: combine ALL + method-specific
  const normalized = method.toUpperCase() as keyof typeof publicRoutes;
  const all = publicRoutes.ALL || [];
  const specific = publicRoutes[normalized] || [];

  return [...new Set([...all, ...specific])];
}

/**
 * Check if a pathname matches any of the given glob patterns
 *
 * @param pathname - Request pathname to check
 * @param patterns - Array of glob patterns
 * @returns true if pathname matches any pattern
 *
 * @example
 * matchesGlobPatterns("/api/config/keycloak", ["/api/config/**"])
 * // Returns: true
 */
export function matchesGlobPatterns(pathname: string, patterns: string[]): boolean {
  const regex = globArrayToRegex(patterns);
  return regex?.test(pathname) ?? false;
}
