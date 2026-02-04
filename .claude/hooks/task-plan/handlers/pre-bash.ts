/**
 * Pre Bash Handler
 * Placeholder for future bash-related planning checks
 * 
 * Git operations are now handled by the separate git-guard hook.
 */

import type { HandlerContext, ClaudeHookInput, OpenCodeHookInput } from "../types";

/**
 * Handle pre-bash hook
 * Currently does nothing - git checking moved to git-guard
 */
export async function preBash(
  _ctx: HandlerContext,
  _input: ClaudeHookInput | OpenCodeHookInput
): Promise<void> {
  // Git operations are now handled by git-guard hook
  // This handler is kept for potential future bash-related checks
}
