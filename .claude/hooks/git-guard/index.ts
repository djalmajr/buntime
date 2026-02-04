#!/usr/bin/env bun
/**
 * Git Guard Hook
 * Entry point for Claude Code hooks
 *
 * Usage:
 *   echo '{"tool_input":{"command":"git commit -m test"}}' | bun run index.ts pre-bash
 *   bun run index.ts bypass
 */

import { loadConfig } from "./config";
import { preBash, handleBypass } from "./handlers";
import type { HandlerContext, ClaudeHookInput } from "./types";

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const config = loadConfig(projectDir);
const ctx: HandlerContext = { projectDir, config };

async function main() {
  const hook = process.argv[2];

  try {
    switch (hook) {
      case "pre-bash":
        await handlePreBash();
        break;

      case "bypass":
        const response = await handleBypass(ctx);
        console.log(response);
        break;

      default:
        console.error(`Unknown hook: ${hook}`);
        console.error("Available hooks: pre-bash, bypass");
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

async function handlePreBash() {
  const stdin = await Bun.stdin.text();
  if (!stdin.trim()) return;

  const input: ClaudeHookInput = JSON.parse(stdin);

  // Only handle Bash tool
  if (input.tool_name !== "Bash" && input.tool_name !== "mcp_bash") {
    return;
  }

  await preBash(ctx, input);
}

main();
