import type { MessageBusState, PiercingGatewayConfig } from "@buntime/piercing";
import type { MiddlewareHandler } from "hono";
import type { PluginRegistry } from "@/plugins/registry";

/**
 * Options for creating a piercing-aware shell middleware
 */
export interface PiercingShellOptions {
  /** The shell HTML content (from client/index.html) */
  shellHtml: string;

  /** Plugin registry with potential fragments */
  registry: PluginRegistry;

  /** Base path for the shell (e.g., "/cpanel") */
  basePath: string;

  /**
   * Generate additional MessageBus state from request
   * Use this to inject user info, theme, or other app-specific state
   */
  generateMessageBusState?: (
    state: MessageBusState,
    request: Request,
  ) => MessageBusState | Promise<MessageBusState>;
}

/**
 * Create a Hono middleware for serving the shell with fragment piercing
 *
 * This middleware:
 * 1. Intercepts HTML requests to the shell basePath
 * 2. Pre-pierces fragments based on route matching
 * 3. Injects MessageBus state
 * 4. Handles fragment SSR requests (/piercing-fragment/:id)
 * 5. Handles fragment asset requests (/_fragment/:id/*)
 *
 * @returns Hono middleware handler, or null if no fragments are registered
 */
export function createPiercingShellMiddleware(
  options: PiercingShellOptions,
): MiddlewareHandler | null {
  const { basePath, generateMessageBusState, registry, shellHtml } = options;

  // Check if there are any fragments to pierce
  if (!registry.hasFragments()) {
    return null;
  }

  // Create gateway config
  const gatewayConfig: PiercingGatewayConfig = {
    getShellHtml: async () => shellHtml,
    generateMessageBusState,
    shouldPiercingBeEnabled: async (request) => {
      // Only enable piercing for routes under the shell basePath
      const url = new URL(request.url);
      return url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);
    },
  };

  // Create the gateway
  const gateway = registry.createPiercingGateway(gatewayConfig);

  if (!gateway) {
    return null;
  }

  console.log(`[PiercingShell] Created piercing middleware for ${basePath}`);

  // Return the gateway middleware
  return gateway.middleware();
}

/**
 * Get the shell HTML content from a BunFile
 * Useful for reading index.html in development
 */
export async function getShellHtml(htmlPath: string): Promise<string> {
  const file = Bun.file(htmlPath);
  return file.text();
}
