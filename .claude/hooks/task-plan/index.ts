#!/usr/bin/env bun
/**
 * Task Plan CLI
 * Entry point for Claude Code hooks
 *
 * Usage: bun run .claude/hooks/task-plan/index.ts <hook-name>
 *
 * Hooks:
 *   session-start  - Load state, show context
 *   user-prompt-submit - Resolve plan from prompt context
 *   pre-tool-use   - Ensure active plan for edits
 *   pre-bash       - (Reserved for future use)
 *   post-tool-use  - Activate plans, track modified files
 *   todo-updated   - Sync TodoWrite with plan checklist
 *   stop           - Report remaining tasks (non-blocking)
 *
 * Note: Git operations are handled by the separate git-guard hook.
 */

import { loadConfig } from "./config";
import { handleBypass } from "./handlers/bypass";
import { postToolUse } from "./handlers/post-tool-use";
import { preBash } from "./handlers/pre-bash";
import { preToolUse } from "./handlers/pre-tool-use";
import { sessionStart } from "./handlers/session-start";
import { stop } from "./handlers/stop";
import { todoUpdated } from "./handlers/todo-updated";
import { userPromptSubmit } from "./handlers/user-prompt-submit";
import type { ClaudeHookInput, HandlerContext, TodoEvent } from "./types";

// Standard handlers (ClaudeHookInput)
const standardHandlers: Record<
  string,
  (ctx: HandlerContext, input: ClaudeHookInput) => Promise<unknown>
> = {
  "session-start": sessionStart,
  "user-prompt-submit": userPromptSubmit,
  "pre-tool-use": preToolUse,
  "pre-bash": preBash,
  "post-tool-use": postToolUse,
  stop: stop,
};

// Special handlers with different input types
const specialHandlers = {
  "todo-updated": todoUpdated,
};

// Maintenance command (kept for backward compatibility)
async function handleSetBypass(ctx: HandlerContext): Promise<string> {
  const type = process.argv[3] as "plan" | "stop";

  if (!type || !["plan", "stop"].includes(type)) {
    throw new Error("Usage: set-bypass <plan|stop>");
  }

  return handleBypass(ctx, type);
}

async function main() {
  const hook = process.argv[2];

  if (!hook) {
    console.error("Usage: bun run index.ts <hook-name>");
    console.error("");
    console.error("Available hooks:");
    console.error("  session-start  - Load state, show context");
    console.error("  user-prompt-submit - Resolve plan from prompt context");
    console.error("  pre-tool-use   - Ensure active plan for edits");
    console.error("  pre-bash       - (Reserved for future use)");
    console.error("  post-tool-use  - Activate plans, track modified files");
    console.error("  todo-updated   - Sync TodoWrite with plan checklist");
    console.error("  stop           - Report remaining tasks (non-blocking)");
    process.exit(1);
  }

  // Handle set-bypass separately
  if (hook === "set-bypass") {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const config = loadConfig(projectDir);
    const ctx: HandlerContext = { projectDir, config };

    try {
      const output = await handleSetBypass(ctx);
      console.log(output);
      process.exit(0);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(2);
    }
  }

  const allHookNames = [...Object.keys(standardHandlers), ...Object.keys(specialHandlers)];
  if (!allHookNames.includes(hook)) {
    console.error(`Unknown hook: ${hook}`);
    console.error("Available hooks: " + allHookNames.join(", "));
    process.exit(1);
  }

  // Get project directory from environment or current directory
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  // Load configuration
  const config = loadConfig(projectDir);

  // Create handler context
  const ctx: HandlerContext = { projectDir, config };

  // Read JSON input from stdin
  let rawInput: unknown = {};
  try {
    const text = await Bun.stdin.text();
    if (text.trim()) {
      rawInput = JSON.parse(text);
    }
  } catch {
    // No input or invalid JSON - that's OK for some hooks
  }

  try {
    // Handle special handlers with different input types
    let output: unknown;
    if (hook === "todo-updated") {
      output = await todoUpdated(ctx, rawInput as TodoEvent);
    } else {
      const stdHandler = standardHandlers[hook];
      output = await stdHandler(ctx, rawInput as ClaudeHookInput);
    }

    // Output result if any
    if (output) {
      if (typeof output === "string") {
        // For session-start, output goes to context
        console.log(output);
      } else {
        // For other hooks, output JSON
        console.log(JSON.stringify(output));
      }
    }

    process.exit(0);
  } catch (error: unknown) {
    // Output error to stderr and exit with code 2 (blocking error)
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(2);
  }
}

main();
