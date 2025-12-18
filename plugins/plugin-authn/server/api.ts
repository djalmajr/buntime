import type { DatabaseAdapter } from "@buntime/plugin-database";
import { errorToResponse } from "@buntime/shared/errors";
import type { PluginLogger } from "@buntime/shared/types";
import { Hono } from "hono";
import { createScimRoutes } from "./scim/routes";
import {
  getAuth,
  getBasePath,
  getLogger,
  getOAuthAccountsForUser,
  getProviderById,
  getProviders,
} from "./services";

// API routes (mounted at /api by worker, runs on main thread via plugin.routes)
export const api = new Hono()
  // Root route: redirect based on auth status
  .get("/", async (ctx) => {
    const auth = getAuth();
    const base = getBasePath();
    if (!auth) {
      return ctx.redirect(`${base}/login`);
    }

    const session = await auth.api.getSession({ headers: ctx.req.raw.headers });
    if (session?.user) {
      // Already logged in, redirect to home
      return ctx.redirect("/");
    }

    // Not logged in, redirect to login
    return ctx.redirect(`${base}/login`);
  })
  .basePath("/api")
  // Get configured providers for login UI
  .get("/providers", (ctx) => {
    return ctx.json(getProviders());
  })
  // Better-auth handles all auth routes
  .all("/auth/*", async (ctx) => {
    const auth = getAuth();
    const logger = getLogger();
    if (!auth) {
      logger?.error("Auth not configured");
      return ctx.json({ error: "Auth not configured" }, 500);
    }
    try {
      // Rewrite URL to match better-auth basePath
      const url = new URL(ctx.req.url);
      const newPath = `/auth${url.pathname}`;
      const newUrl = new URL(newPath + url.search, url.origin);
      const newReq = new Request(newUrl.toString(), ctx.req.raw);
      logger?.debug("Auth route hit", { originalPath: ctx.req.path, rewrittenPath: newPath });
      return await auth.handler(newReq);
    } catch (err) {
      logger?.error("Auth handler error", { error: String(err) });
      throw err;
    }
  })
  .all("/auth", async (ctx) => {
    const auth = getAuth();
    if (!auth) {
      return ctx.json({ error: "Auth not configured" }, 500);
    }
    return auth.handler(ctx.req.raw);
  })
  // Session endpoint
  .get("/session", async (ctx) => {
    const auth = getAuth();
    if (!auth) {
      return ctx.json({ error: "Auth not configured" }, 500);
    }
    const session = await auth.api.getSession({
      headers: ctx.req.raw.headers,
    });
    return ctx.json(session);
  })
  // Logout endpoints with OIDC provider logout support
  .get("/logout", async (ctx) => {
    const auth = getAuth();
    const logger = getLogger();
    const redirect = ctx.req.query("redirect") || "/";
    const url = new URL(ctx.req.url);
    const postLogoutUri = `${url.origin}${redirect}`;

    logger?.info("Logout requested", { redirect, postLogoutUri });

    if (!auth) {
      logger?.warn("Auth not configured, redirecting to", { redirect });
      return ctx.redirect(redirect);
    }

    try {
      // Get session to find user
      const session = await auth.api.getSession({ headers: ctx.req.raw.headers });
      logger?.info("Session found", { hasSession: !!session, userId: session?.user?.id });

      if (session?.user) {
        // Get user's OAuth accounts with tokens directly from database
        const accounts = await getOAuthAccountsForUser(session.user.id);
        logger?.info("OAuth accounts for user", {
          accountCount: accounts.length,
          accounts: accounts.map((a) => ({
            hasIdToken: !!a.idToken,
            idTokenLength: a.idToken?.length ?? 0,
            providerId: a.providerId,
          })),
          userId: session.user.id,
        });

        // Find an OIDC account with idToken
        const oidcAccount = accounts.find((acc) => acc.idToken);
        logger?.info("OIDC account search result", {
          found: !!oidcAccount,
          providerId: oidcAccount?.providerId,
        });

        if (oidcAccount?.idToken) {
          const provider = getProviderById(oidcAccount.providerId);
          logger?.info("Provider lookup", {
            found: !!provider,
            hasGetLogoutUrl: !!provider?.getLogoutUrl,
            providerId: oidcAccount.providerId,
          });

          if (provider?.getLogoutUrl) {
            // Get provider's logout URL
            const logoutUrl = await provider.getLogoutUrl(oidcAccount.idToken, postLogoutUri);
            logger?.info("OIDC logout URL", { logoutUrl });

            if (logoutUrl) {
              // Clear local session and capture Set-Cookie headers
              const signOutResponse = await auth.api.signOut({
                asResponse: true,
                headers: ctx.req.raw.headers,
              });
              logger?.info("Local session cleared", {
                signOutHeaders: [...signOutResponse.headers.entries()],
              });

              // Create redirect response with cookie-clearing headers
              const redirectResponse = new Response(null, {
                headers: { Location: logoutUrl },
                status: 302,
              });

              // Copy Set-Cookie headers from signOut response
              const setCookieHeaders = signOutResponse.headers.getSetCookie();
              for (const cookie of setCookieHeaders) {
                redirectResponse.headers.append("Set-Cookie", cookie);
              }

              logger?.info("Redirecting to OIDC logout with cookies", {
                cookieCount: setCookieHeaders.length,
                logoutUrl,
                providerId: oidcAccount.providerId,
              });

              return redirectResponse;
            }
          }
        }
      } else {
        logger?.warn("No session found for logout");
      }

      // Fallback: just clear local session with cookies
      const signOutResponse = await auth.api.signOut({
        asResponse: true,
        headers: ctx.req.raw.headers,
      });

      const redirectResponse = new Response(null, {
        headers: { Location: redirect },
        status: 302,
      });

      for (const cookie of signOutResponse.headers.getSetCookie()) {
        redirectResponse.headers.append("Set-Cookie", cookie);
      }

      return redirectResponse;
    } catch (err) {
      logger?.error("Logout error", { error: String(err) });
      // Still try to sign out on error
      try {
        const signOutResponse = await auth.api.signOut({
          asResponse: true,
          headers: ctx.req.raw.headers,
        });

        const redirectResponse = new Response(null, {
          headers: { Location: redirect },
          status: 302,
        });

        for (const cookie of signOutResponse.headers.getSetCookie()) {
          redirectResponse.headers.append("Set-Cookie", cookie);
        }

        return redirectResponse;
      } catch {
        // Ignore
      }
    }

    return ctx.redirect(redirect);
  })
  .post("/logout", async (ctx) => {
    const auth = getAuth();
    const logger = getLogger();

    if (!auth) {
      return ctx.json({ error: "Auth not configured" }, 500);
    }

    try {
      // Get session to find user
      const session = await auth.api.getSession({ headers: ctx.req.raw.headers });
      let oidcLogoutUrl: string | null = null;

      if (session?.user) {
        // Get user's OAuth accounts with tokens directly from database
        const accounts = await getOAuthAccountsForUser(session.user.id);
        const oidcAccount = accounts.find((acc) => acc.idToken);

        if (oidcAccount?.idToken) {
          const provider = getProviderById(oidcAccount.providerId);
          const url = new URL(ctx.req.url);

          if (provider?.getLogoutUrl) {
            oidcLogoutUrl = await provider.getLogoutUrl(oidcAccount.idToken, url.origin);
          }
        }
      }

      await auth.api.signOut({ headers: ctx.req.raw.headers });

      return ctx.json({
        oidcLogoutUrl, // Client can redirect to this URL to complete OIDC logout
        success: true,
      });
    } catch (err) {
      logger?.error("Logout error", { error: String(err) });
      // Still try to sign out
      try {
        await auth.api.signOut({ headers: ctx.req.raw.headers });
      } catch {
        // Ignore
      }
      return ctx.json({ success: true });
    }
  })
  .onError((err) => {
    const logger = getLogger();
    logger?.error("AuthN API error", { error: err.message });
    return errorToResponse(err);
  });

/**
 * SCIM routes configuration
 */
export interface ScimConfig {
  adapter: DatabaseAdapter;
  baseUrl: string;
  bulkEnabled?: boolean;
  enabled: boolean;
  logger?: PluginLogger;
  maxBulkOperations?: number;
  maxResults?: number;
}

/**
 * Mount SCIM routes on the API
 * Should be called after database adapter is available
 */
export function mountScimRoutes(config: ScimConfig): void {
  if (!config.enabled) {
    return;
  }

  const scimRoutes = createScimRoutes({
    adapter: config.adapter,
    baseUrl: config.baseUrl,
    bulkEnabled: config.bulkEnabled,
    logger: config.logger,
    maxBulkOperations: config.maxBulkOperations,
    maxResults: config.maxResults,
  });

  // Mount SCIM routes at /api/scim/v2
  api.route("/scim/v2", scimRoutes);

  config.logger?.info("SCIM 2.0 routes mounted at /auth/api/scim/v2");
}

// Export type for API client
export type ApiType = typeof api;
