/**
 * Runtime configuration
 *
 * In development: Uses localhost:8000 (buntime dev server)
 * In production: Empty string (same origin, cpanel runs as buntime worker)
 */

/**
 * Detect if running in development mode.
 * In production (buntime worker), the origin will be the same as buntime.
 */
const isDev = location.hostname === "localhost" && location.port === "3000";

/**
 * Base URL for buntime API and micro-frontends.
 * Empty string means same origin (production).
 */
export const BUNTIME_URL = isDev ? "http://localhost:8000" : "";
