export { createIframeSandbox, IFRAME_CLIENT_SCRIPT } from "./iframe";

export { createMonkeyPatchSandbox } from "./monkey-patch";
export {
  createServiceWorkerSandbox,
  initPiercingServiceWorker,
  SERVICE_WORKER_SCRIPT,
} from "./service-worker";
export type {
  SandboxConfig,
  SandboxNavigateEvent,
  SandboxStrategy,
  SandboxStrategyHandler,
} from "./types";

import { createIframeSandbox } from "./iframe";
import { createMonkeyPatchSandbox } from "./monkey-patch";
import { createServiceWorkerSandbox } from "./service-worker";
import type { SandboxConfig, SandboxStrategyHandler } from "./types";

/**
 * Create a sandbox handler based on strategy type
 *
 * @param config - Sandbox configuration
 * @param container - Container element (required for iframe strategy)
 */
export function createSandbox(
  config: SandboxConfig,
  container?: HTMLElement,
): SandboxStrategyHandler | null {
  switch (config.strategy) {
    case "none":
      return null;

    case "monkey-patch":
      return createMonkeyPatchSandbox(config);

    case "iframe":
      if (!container) {
        throw new Error("Iframe sandbox requires a container element");
      }
      return createIframeSandbox(config, container);

    case "service-worker":
      return createServiceWorkerSandbox(config);

    default:
      console.warn(`[Piercing] Unknown sandbox strategy: ${config.strategy}`);
      return null;
  }
}
