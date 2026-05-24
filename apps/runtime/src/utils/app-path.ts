/**
 * Parse a request pathname into the worker "app key" that addresses it.
 *
 * Workers are addressed by their name in the URL. A namespaced (npm-scoped)
 * worker `@namespace/app` is served at `/@namespace/app/...` — the first two
 * segments form the name when the first starts with `@`. An unscoped worker
 * `app` is served at `/app/...` (single segment).
 *
 * This is the single source of truth for that rule; `resolveTargetApp`
 * (app.ts) and the worker router (routes/worker.ts) both use it so the
 * single-vs-namespaced decision lives in one place.
 *
 * @example
 * parseAppPath("/checkout/page")          // { name: "checkout", basePath: "/checkout", rest: "/page" }
 * parseAppPath("/@acme/checkout")    // { name: "@acme/checkout", basePath: "/@acme/checkout", rest: "/" }
 * parseAppPath("/@acme/checkout/x")  // { name: "@acme/checkout", basePath: "/@acme/checkout", rest: "/x" }
 * parseAppPath("/")                        // null
 */
export interface ParsedAppPath {
  /** Worker name/key: `app` or `@namespace/app`. */
  name: string;
  /** URL prefix the worker is mounted at: `/${name}`. */
  basePath: string;
  /** Pathname relative to `basePath`, always starting with `/`. */
  rest: string;
}

export function parseAppPath(pathname: string): ParsedAppPath | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  // Namespaced worker: `@scope/app` is a two-segment name.
  const segmentCount = segments[0]!.startsWith("@") && segments.length >= 2 ? 2 : 1;

  const name = segments.slice(0, segmentCount).join("/");
  const basePath = `/${name}`;
  // Slice the base off the original pathname so a meaningful trailing slash on
  // a subpath is preserved (matches the previous `pathname.slice(...)` logic).
  const rest = pathname.slice(basePath.length) || "/";

  return { basePath, name, rest };
}
