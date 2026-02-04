#!/usr/bin/env bun
/**
 * Code Quality Hook
 * Entry point for Claude Code hooks
 *
 * Usage:
 *   bun run index.ts post-tool-use < input.json
 *   bun run index.ts verify
 */

import { loadConfig } from "./config";
import { postToolUse, preComplete, formatResults } from "./handlers";
import type { HandlerContext, ClaudeHookInput } from "./types";

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const config = loadConfig(projectDir);
const ctx: HandlerContext = { projectDir, config };

async function main() {
  const hook = process.argv[2];

  try {
    switch (hook) {
      case "post-tool-use":
        await handlePostToolUse();
        break;

      case "verify":
        await handleVerify();
        break;

      default:
        console.error(`Unknown hook: ${hook}`);
        console.error("Available hooks: post-tool-use, verify");
        process.exit(1);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }
}

async function handlePostToolUse() {
  const stdin = await Bun.stdin.text();
  if (!stdin.trim()) return;

  const input: ClaudeHookInput = JSON.parse(stdin);

  // Only handle Edit/Write tools
  const toolName = input.tool_name || "";
  if (!/(Edit|Write|mcp_edit|mcp_write)/i.test(toolName)) {
    return;
  }

  await postToolUse(ctx, input);
}

async function handleVerify() {
  const results = await preComplete(ctx);
  console.log(formatResults(results));

  if (!results.success) {
    process.exit(2);
  }
}

main();
