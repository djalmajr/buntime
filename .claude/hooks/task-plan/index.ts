#!/usr/bin/env bun
/**
 * Task Plan CLI
 * Entry point for Claude Code hooks
 * 
 * Usage: bun run .claude/hooks/task-plan/index.ts <hook-name>
 * 
 * Hooks:
 *   session-start  - Load state, show context
 *   pre-tool-use   - Block edits without active plan
 *   pre-bash       - (Reserved for future use)
 *   post-tool-use  - Activate plans, track modified files
 *   todo-updated   - Sync TodoWrite with plan checklist
 *   stop           - Block if tasks pending
 * 
 * Internal (invoked by slash commands only):
 *   set-bypass <type>  - Set bypass flag (plan|stop)
 * 
 * Note: Git operations are handled by the separate git-guard hook.
 */

import { loadConfig } from "./config";
import { sessionStart } from "./handlers/session-start";
import { preToolUse } from "./handlers/pre-tool-use";
import { preBash } from "./handlers/pre-bash";
import { postToolUse } from "./handlers/post-tool-use";
import { todoUpdated } from "./handlers/todo-updated";
import { stop } from "./handlers/stop";
import { handleBypass } from "./handlers/bypass";
import type { HandlerContext, ClaudeHookInput, TodoEvent } from "./types";

// Standard handlers (ClaudeHookInput)
const standardHandlers: Record<string, (ctx: HandlerContext, input: ClaudeHookInput) => Promise<unknown>> = {
  "session-start": sessionStart,
  "pre-tool-use": preToolUse,
  "pre-bash": preBash,
  "post-tool-use": postToolUse,
  "stop": stop,
};

// Special handlers with different input types
const specialHandlers = {
  "todo-updated": todoUpdated,
};

// Handle set-bypass command separately (requires additional argument)
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
    console.error("  pre-tool-use   - Block edits without active plan");
    console.error("  pre-bash       - (Reserved for future use)");
    console.error("  post-tool-use  - Activate plans, track modified files");
    console.error("  todo-updated   - Sync TodoWrite with plan checklist");
    console.error("  stop           - Block if tasks pending");
    process.exit(1);
  }

  // Handle set-bypass separately (internal command for slash commands)
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
