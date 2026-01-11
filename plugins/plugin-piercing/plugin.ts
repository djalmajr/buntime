import type { AppInfo, BasePluginConfig, PluginContext, PluginImpl } from "@buntime/shared/types";

export interface PiercingConfig extends BasePluginConfig {
  /**
   * Enable/disable pre-piercing
   * @default true
   */
  enabled?: boolean;
}

let logger: PluginContext["logger"] | undefined;
let enabled = true;

/**
 * Parse HTML for fragment-outlet elements and extract src attributes
 */
function parseFragmentOutlets(html: string): string[] {
  const sources: string[] = [];
  // Match <fragment-outlet src="..." /> or <fragment-outlet src="..."></fragment-outlet>
  const regex = /<fragment-outlet[^>]+src=["']([^"']+)["'][^>]*\/?>/gi;
  let match: RegExpExecArray | null;

  // Use matchAll instead of exec loop
  for (const m of html.matchAll(regex)) {
    if (m[1]) {
      sources.push(m[1]);
    }
  }

  return sources;
}

/**
 * Fetch a fragment and wrap in fragment-host
 */
async function fetchFragment(
  src: string,
  baseUrl: string,
): Promise<{ src: string; html: string } | null> {
  try {
    // Resolve relative URLs against base
    const url = new URL(src, baseUrl);
    const response = await fetch(url.href);

    if (!response.ok) {
      logger?.warn(`Failed to fetch fragment from ${src}: ${response.status}`);
      return null;
    }

    const html = await response.text();
    return { src, html };
  } catch (error) {
    logger?.error(`Error fetching fragment from ${src}:`, { error });
    return null;
  }
}

/**
 * Wrap fragment content in fragment-host element
 */
function wrapInHost(src: string, content: string): string {
  return `<fragment-host src="${src}">${content}</fragment-host>`;
}

/**
 * Process HTML response for pre-piercing
 */
async function prePierceResponse(response: Response, baseUrl: string): Promise<Response> {
  const html = await response.text();

  // Find all fragment-outlet elements with src attributes
  const sources = parseFragmentOutlets(html);

  if (sources.length === 0) {
    // No outlets found, return original response
    return new Response(html, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  logger?.debug(`Found ${sources.length} fragment outlet(s) to pre-pierce`);

  // Fetch all fragments in parallel
  const fragments = await Promise.all(sources.map((src) => fetchFragment(src, baseUrl)));

  // Filter out failed fetches and wrap in hosts
  const hosts = fragments
    .filter((f): f is { src: string; html: string } => f !== null)
    .map((f) => wrapInHost(f.src, f.html));

  if (hosts.length === 0) {
    // All fetches failed, return original
    return new Response(html, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  // Inject fragment hosts before </body>
  const injected = hosts.join("\n");
  let modifiedHtml: string;

  const bodyEndIndex = html.lastIndexOf("</body>");
  if (bodyEndIndex !== -1) {
    modifiedHtml = `${html.slice(0, bodyEndIndex)}${injected}\n${html.slice(bodyEndIndex)}`;
  } else {
    // No </body> found, append at the end
    modifiedHtml = `${html}\n${injected}`;
  }

  logger?.debug(`Pre-pierced ${hosts.length} fragment(s)`);

  // Clone headers to avoid modifying original
  const headers = new Headers(response.headers);
  // Update content-length since we modified the body
  headers.delete("content-length");

  return new Response(modifiedHtml, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

/**
 * Piercing plugin for Buntime
 *
 * Provides server-side pre-piercing of fragment-outlet elements.
 * Scans HTML responses for <fragment-outlet src="..."> and fetches
 * fragment content to inject as <fragment-host src="..."> before </body>.
 *
 * This enables SSR for micro-frontend fragments, reducing time-to-content.
 */
export default function piercingPlugin(pluginConfig: PiercingConfig = {}): PluginImpl {
  enabled = pluginConfig.enabled ?? true;

  return {
    onInit(ctx: PluginContext) {
      logger = ctx.logger;
      logger.info(`Piercing plugin initialized (pre-piercing ${enabled ? "enabled" : "disabled"})`);
    },

    async onResponse(response: Response, app: AppInfo): Promise<Response> {
      // Skip if disabled
      if (!enabled) {
        return response;
      }

      // Only process HTML responses
      const contentType = response.headers.get("content-type");
      if (!contentType?.includes("text/html")) {
        return response;
      }

      // Skip streaming responses (no content-length or chunked)
      const transferEncoding = response.headers.get("transfer-encoding");
      if (transferEncoding === "chunked") {
        return response;
      }

      // Build base URL for resolving relative fragment URLs
      // Use the app name to construct the base
      const baseUrl = `http://localhost/${app.name}`;

      try {
        return await prePierceResponse(response, baseUrl);
      } catch (error) {
        logger?.error("Error in pre-piercing:", { error });
        return response;
      }
    },
  };
}
