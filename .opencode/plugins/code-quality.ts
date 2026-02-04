/**
 * Code Quality Plugin - OpenCode Thin Adapter
 *
 * This adapter delegates to the shared handlers in .claude/hooks/code-quality/
 * to ensure both Claude Code and OpenCode use the same logic.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { loadConfig } from "../../.claude/hooks/code-quality/config";
import type { HandlerContext, OpenCodeHookInput } from "../../.claude/hooks/code-quality/types";
import { postToolUse } from "../../.claude/hooks/code-quality/handlers";

// =============================================================================
// Code Quality Plugin
// =============================================================================

/**
 * Code Quality Plugin for OpenCode
 *
 * Thin adapter that routes OpenCode events to shared handlers:
 * - tool.execute.after → postToolUse (for write operations)
 */
export const CodeQuality: Plugin = async ({ client, directory }) => {
  const config = loadConfig(directory);

  const ctx: HandlerContext = {
    projectDir: directory,
    config,
    client,
  };

  return {
    // After tool execution: run lint check
    "tool.execute.after": async (input, output) => {
      const tool = input.tool.toLowerCase();

      // Only handle write operations
      if (isWriteOperation(tool)) {
        const hookInput: OpenCodeHookInput = {
          tool,
          args: output.metadata as OpenCodeHookInput["args"],
        };
        await postToolUse(ctx, hookInput);
      }
    },
  };
};

// =============================================================================
// Helpers
// =============================================================================

function isWriteOperation(tool: string): boolean {
  const writeTools = ["write", "mcp_write", "edit", "mcp_edit"];
  return writeTools.includes(tool.toLowerCase());
}
