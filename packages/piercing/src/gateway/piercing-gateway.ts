import type { Context, MiddlewareHandler } from "hono";
import { ServerMessageBus } from "../message-bus/server-message-bus";
import type { FragmentConfig, MessageBusState, PiercingGatewayConfig } from "../types";
import { concatenateStreams, stringToStream, wrapStreamInText } from "./stream-utils";

/**
 * Generate the inline script that initializes the client message bus
 */
function getMessageBusInlineScript(stateJson: string): string {
  return `<script>
(function() {
  window.__PIERCING_MESSAGE_BUS_STATE__ = ${stateJson};
})();
</script>`;
}

/**
 * Generate the inline script that registers piercing web components
 */
function getPiercingComponentsScript(): string {
  return `<script type="module">
import { registerPiercingComponents } from '/_piercing/client.js';
registerPiercingComponents();
</script>`;
}

/**
 * Piercing Gateway for micro-frontend fragment integration
 *
 * Handles:
 * - Fragment SSR requests: /piercing-fragment/:id
 * - Fragment asset requests: /_fragment/:id/*
 * - Pre-piercing fragments into HTML responses
 */
export class PiercingGateway {
  private fragments = new Map<string, FragmentConfig>();

  constructor(private config: PiercingGatewayConfig) {}

  /**
   * Register a fragment with the gateway
   */
  registerFragment(config: FragmentConfig): void {
    if (this.fragments.has(config.fragmentId)) {
      console.warn(
        `[PiercingGateway] Fragment "${config.fragmentId}" already registered, ignoring duplicate`,
      );
      return;
    }
    this.fragments.set(config.fragmentId, config);
    console.log(`[PiercingGateway] Registered fragment: ${config.fragmentId}`);
  }

  /**
   * Get all registered fragments
   */
  getFragments(): FragmentConfig[] {
    return Array.from(this.fragments.values());
  }

  /**
   * Create Hono middleware for the piercing gateway
   */
  middleware(): MiddlewareHandler {
    return async (ctx, next) => {
      const { req } = ctx;
      const url = new URL(req.url);
      const pathname = url.pathname;

      // 1. Handle fragment SSR requests: /piercing-fragment/:id
      const fragmentMatch = pathname.match(/^\/piercing-fragment\/([^/?]+)/);
      if (fragmentMatch?.[1]) {
        return this.handleFragmentRequest(ctx, fragmentMatch[1]);
      }

      // 2. Handle fragment asset requests: /_fragment/:id/*
      const assetMatch = pathname.match(/^\/_fragment\/([^/]+)(\/.*)?$/);
      if (assetMatch?.[1]) {
        return this.handleFragmentAssetRequest(ctx, assetMatch[1], assetMatch[2] || "/");
      }

      // 3. For HTML requests, potentially pre-pierce fragments
      const acceptsHtml = req.header("Accept")?.includes("text/html");
      if (acceptsHtml && this.fragments.size > 0) {
        return this.handleHtmlRequest(ctx, next);
      }

      // 4. Pass through to next handler
      return next();
    };
  }

  /**
   * Handle a request for fragment SSR content
   */
  private async handleFragmentRequest(ctx: Context, fragmentId: string): Promise<Response> {
    const fragment = this.fragments.get(fragmentId);

    if (!fragment) {
      return ctx.text(`Fragment "${fragmentId}" not found`, 404);
    }

    try {
      // Check if fragment should be included
      if (fragment.shouldBeIncluded) {
        const shouldInclude = await fragment.shouldBeIncluded(ctx.req.raw);
        if (!shouldInclude) {
          return ctx.text(`Fragment "${fragmentId}" not available`, 403);
        }
      }

      // Create message bus from request state
      const messageBus = ServerMessageBus.fromRequest(ctx.req.raw);

      // Build the request for the fragment
      let fragmentRequest = messageBus.toRequest(ctx.req.raw);

      // Apply request transformation if defined
      if (fragment.transformRequest) {
        fragmentRequest = await fragment.transformRequest(fragmentRequest);
        // Re-apply message bus headers after transformation
        fragmentRequest = messageBus.toRequest(fragmentRequest);
      }

      // Fetch the fragment SSR content
      const response = await fragment.fetchFragment(fragmentRequest);

      if (!response.body) {
        return ctx.text(`Fragment "${fragmentId}" returned empty response`, 500);
      }

      // Wrap in fragment host element
      const wrappedStream = this.wrapFragmentInHost(
        fragmentId,
        response.body,
        fragment.prePiercingStyles,
      );

      return new Response(wrappedStream, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    } catch (error) {
      console.error(`[PiercingGateway] Error fetching fragment "${fragmentId}":`, error);
      return ctx.text(`Error fetching fragment "${fragmentId}"`, 500);
    }
  }

  /**
   * Handle a request for fragment static assets
   */
  private async handleFragmentAssetRequest(
    ctx: Context,
    fragmentId: string,
    assetPath: string,
  ): Promise<Response> {
    const fragment = this.fragments.get(fragmentId);

    if (!fragment) {
      return ctx.text(`Fragment "${fragmentId}" not found`, 404);
    }

    if (!fragment.serveAssets) {
      return ctx.text(`Fragment "${fragmentId}" does not serve assets`, 404);
    }

    try {
      // Create a new request with the asset path
      const url = new URL(ctx.req.url);
      url.pathname = assetPath;
      const assetRequest = new Request(url.toString(), ctx.req.raw);

      return fragment.serveAssets(assetRequest);
    } catch (error) {
      console.error(`[PiercingGateway] Error serving asset for "${fragmentId}":`, error);
      return ctx.text("Asset not found", 404);
    }
  }

  /**
   * Handle an HTML request, potentially pre-piercing fragments
   */
  private async handleHtmlRequest(
    ctx: Context,
    next: () => Promise<Response | void>,
  ): Promise<Response> {
    // Check if piercing is enabled for this request
    if (this.config.shouldPiercingBeEnabled) {
      const enabled = await this.config.shouldPiercingBeEnabled(ctx.req.raw);
      if (!enabled) {
        const response = await next();
        return response || ctx.text("Not found", 404);
      }
    }

    // Create message bus state
    const requestState = ServerMessageBus.fromRequest(ctx.req.raw);
    let messageBusState: MessageBusState = requestState.state;

    if (this.config.generateMessageBusState) {
      messageBusState = await this.config.generateMessageBusState(messageBusState, ctx.req.raw);
    }

    // Get the shell HTML
    const shellHtml = await this.config.getShellHtml(ctx.req.raw);

    // Find fragments that should be pre-pierced for this route
    const fragmentsToPrePierce = await this.getFragmentsToPrePierce(ctx.req.raw);

    // Fetch all pre-pierce fragments in parallel
    const fragmentStreams = await Promise.all(
      fragmentsToPrePierce.map(async (fragment) => {
        try {
          const messageBus = new ServerMessageBus(messageBusState);

          // Build the request for the fragment
          let fragmentRequest = messageBus.toRequest(ctx.req.raw);

          // Apply request transformation if defined
          if (fragment.transformRequest) {
            fragmentRequest = await fragment.transformRequest(fragmentRequest);
            // Re-apply message bus headers after transformation
            fragmentRequest = messageBus.toRequest(fragmentRequest);
          }

          const response = await fragment.fetchFragment(fragmentRequest);

          if (!response.body) return null;

          return this.wrapFragmentInHost(
            fragment.fragmentId,
            response.body,
            fragment.prePiercingStyles,
          );
        } catch (error) {
          console.error(
            `[PiercingGateway] Error pre-piercing fragment "${fragment.fragmentId}":`,
            error,
          );
          return null;
        }
      }),
    );

    // Filter out failed fragments
    const validStreams = fragmentStreams.filter((s): s is ReadableStream<Uint8Array> => s !== null);

    // Inject message bus state and components script into HTML
    const injectedHtml = this.injectScriptsIntoHtml(shellHtml, messageBusState);

    // Combine shell HTML with pre-pierced fragments
    const combinedHtml = this.combineHtmlWithFragments(injectedHtml, validStreams);

    return new Response(combinedHtml, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  }

  /**
   * Get fragments that should be pre-pierced for the current request
   * Checks both route matching and shouldBeIncluded condition
   */
  private async getFragmentsToPrePierce(request: Request): Promise<FragmentConfig[]> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    const candidates = Array.from(this.fragments.values()).filter((fragment) => {
      if (!fragment.prePierceRoutes || fragment.prePierceRoutes.length === 0) {
        return false;
      }

      return fragment.prePierceRoutes.some((route) => {
        // Simple glob matching: * matches any characters
        const regex = new RegExp(`^${route.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
        return regex.test(pathname);
      });
    });

    // Check shouldBeIncluded for each candidate in parallel
    const results = await Promise.all(
      candidates.map(async (fragment) => {
        if (!fragment.shouldBeIncluded) {
          return fragment; // No condition, include by default
        }
        const shouldInclude = await fragment.shouldBeIncluded(request);
        return shouldInclude ? fragment : null;
      }),
    );

    return results.filter((f): f is FragmentConfig => f !== null);
  }

  /**
   * Wrap fragment content in a piercing-fragment-host element
   */
  private wrapFragmentInHost(
    fragmentId: string,
    contentStream: ReadableStream<Uint8Array>,
    prePiercingStyles?: string,
  ): ReadableStream<Uint8Array> {
    const styleTag = prePiercingStyles ? `<style>${prePiercingStyles}</style>` : "";

    const before = `<piercing-fragment-host fragment-id="${fragmentId}">${styleTag}`;
    const after = `</piercing-fragment-host>`;

    return wrapStreamInText(before, after, contentStream);
  }

  /**
   * Inject message bus state and component scripts into HTML
   */
  private injectScriptsIntoHtml(html: string, state: MessageBusState): string {
    const stateJson = JSON.stringify(state);
    const scripts = `${getMessageBusInlineScript(stateJson)}\n${getPiercingComponentsScript()}`;

    // Inject before </head>
    const headEndIndex = html.indexOf("</head>");
    if (headEndIndex !== -1) {
      return `${html.slice(0, headEndIndex)}${scripts}\n${html.slice(headEndIndex)}`;
    }

    // Fallback: inject at start of body
    const bodyStartIndex = html.indexOf("<body");
    if (bodyStartIndex !== -1) {
      const bodyTagEnd = html.indexOf(">", bodyStartIndex);
      return `${html.slice(0, bodyTagEnd + 1)}${scripts}\n${html.slice(bodyTagEnd + 1)}`;
    }

    // Last resort: prepend
    return scripts + html;
  }

  /**
   * Combine shell HTML with pre-pierced fragment streams
   */
  private combineHtmlWithFragments(
    html: string,
    fragmentStreams: ReadableStream<Uint8Array>[],
  ): ReadableStream<Uint8Array> {
    if (fragmentStreams.length === 0) {
      return stringToStream(html);
    }

    // Insert fragments before </body>
    const bodyEndIndex = html.indexOf("</body>");
    if (bodyEndIndex === -1) {
      // No body tag, just concatenate
      return concatenateStreams([stringToStream(html), ...fragmentStreams]);
    }

    const beforeBody = html.slice(0, bodyEndIndex);
    const afterBody = html.slice(bodyEndIndex);

    return concatenateStreams([
      stringToStream(beforeBody),
      ...fragmentStreams,
      stringToStream(afterBody),
    ]);
  }
}
