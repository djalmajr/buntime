/**
 * Git Guard Plugin - OpenCode Thin Adapter
 *
 * This adapter delegates to the shared handlers in .claude/hooks/git-guard/
 * to ensure both Claude Code and OpenCode use the same logic.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { loadConfig } from "../../.claude/hooks/git-guard/config";
import type { HandlerContext, OpenCodeHookInput } from "../../.claude/hooks/git-guard/types";
import { preBash } from "../../.claude/hooks/git-guard/handlers";

// =============================================================================
// Git Guard Plugin
// =============================================================================

/**
 * Git Guard Plugin for OpenCode
 *
 * Thin adapter that routes OpenCode events to shared handlers:
 * - tool.execute.before → preBash (for bash/mcp_bash tools)
 */
export const GitGuard: Plugin = async ({ client, directory }) => {
  const config = loadConfig(directory);

  const ctx: HandlerContext = {
    projectDir: directory,
    config,
    client,
  };

  return {
    // Before tool execution: check for blocked git commands
    "tool.execute.before": async (input, output) => {
      const tool = input.tool.toLowerCase();
      const args = output.args || {};

      // Only handle bash tools
      if (tool === "bash" || tool === "mcp_bash") {
        const hookInput: OpenCodeHookInput = {
          tool,
          args: args as OpenCodeHookInput["args"],
        };
        await preBash(ctx, hookInput);
      }
    },
  };
};
