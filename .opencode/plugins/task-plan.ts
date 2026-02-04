/**
 * Task Plan Plugin - OpenCode Adapter
 *
 * This adapter delegates to the shared handlers in .claude/hooks/task-plan/
 * to ensure both Claude Code and OpenCode use the same logic.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { loadConfig } from "../../.claude/hooks/task-plan/config";
import type { HandlerContext, OpenCodeHookInput, TodoEvent } from "../../.claude/hooks/task-plan/types";
import * as handlers from "../../.claude/hooks/task-plan/handlers";

// =============================================================================
// Task Plan Plugin
// =============================================================================

/**
 * Task Plan Plugin for OpenCode
 *
 * Thin adapter that routes OpenCode events to shared handlers:
 * - session.created → sessionStart
 * - tool.execute.before → preToolUse
 * - tool.execute.after → postToolUse
 * - todo.updated → todoUpdated
 * - session.idle → stop
 */
export const TaskPlan: Plugin = async ({ client, directory }) => {
  const config = loadConfig(directory);

  const ctx: HandlerContext = {
    projectDir: directory,
    config,
    client,
  };

  return {
    // Event handler for session and todo events
    event: async ({ event }) => {
      // Session start: show state and instructions
      if (event.type === "session.created") {
        await handlers.sessionStart(ctx, {});
      }

      // Todo updated: sync with plan checklist
      if (event.type === "todo.updated") {
        const todoEvent = event.properties as unknown as TodoEvent;
        await handlers.todoUpdated(ctx, todoEvent);
      }

      // Session idle: check pending items before stop
      if (event.type === "session.idle") {
        await handlers.stop(ctx, {});
      }
    },

    // Before tool execution: validate and block/warn
    // Note: Git operations are handled by the separate git-guard plugin
    "tool.execute.before": async (input, output) => {
      const tool = input.tool.toLowerCase();
      const args = output.args || {};

      // Only handle write operations (git is handled by git-guard plugin)
      if (isWriteOperation(tool)) {
        const hookInput: OpenCodeHookInput = {
          tool,
          args: args as OpenCodeHookInput["args"],
        };
        await handlers.preToolUse(ctx, hookInput);
      }
    },

    // After tool execution: track files and detect plan completion
    "tool.execute.after": async (input, output) => {
      const tool = input.tool.toLowerCase();

      if (isWriteOperation(tool)) {
        const hookInput: OpenCodeHookInput = {
          tool,
          args: output.metadata as OpenCodeHookInput["args"],
        };
        await handlers.postToolUse(ctx, hookInput);
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
