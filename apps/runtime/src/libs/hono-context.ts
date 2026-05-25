/**
 * @module
 * Global augmentation of Hono's `ContextVariableMap` so any route handler can
 * read the authenticated principal with `c.get("principal")` (and the API gate
 * can publish it with `c.set("principal", ...)`) without threading a generic
 * `Variables` type through every router. The API middleware in
 * `apps/runtime/src/app.ts` sets this on every authenticated `/api/*` request;
 * downstream handlers (fs, workers, plugins) read it for namespace-scoped
 * access control.
 *
 * Importing this module anywhere in the runtime build makes the augmentation
 * visible program-wide (ambient `declare module`).
 */

import type { ApiKeyPrincipal } from "@/libs/api-keys";

declare module "hono" {
  interface ContextVariableMap {
    /** Authenticated principal for the current request, when a valid key was presented. */
    principal?: ApiKeyPrincipal;
  }
}
