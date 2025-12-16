export { createIframeSandbox, IFRAME_CLIENT_SCRIPT } from "./iframe";

export { createPatchSandbox } from "./patch";
export type {
  SandboxConfig,
  SandboxNavigateEvent,
  SandboxStrategy,
  SandboxStrategyHandler,
} from "./types";

import { createIframeSandbox } from "./iframe";
import { createPatchSandbox } from "./patch";
import type { SandboxConfig, SandboxStrategyHandler } from "./types";

/**
 * Create a sandbox handler based on strategy type
 *
 * @param config - Sandbox configuration
 * @param container - Container element (required for isolate strategy)
 */
export function createSandbox(
  config: SandboxConfig,
  container?: HTMLElement,
): SandboxStrategyHandler | null {
  switch (config.strategy) {
    case "patch":
      return createPatchSandbox(config);

    case "isolate":
      if (!container) {
        throw new Error("Isolate sandbox requires a container element");
      }
      return createIframeSandbox(config, container);

    default:
      console.warn(`[Piercing] Unknown sandbox strategy: ${config.strategy}`);
      return null;
  }
}
