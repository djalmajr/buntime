/**
 * Pre Bash Handler
 * Blocks dangerous git operations
 */

import type { HandlerContext, ClaudeHookInput, OpenCodeHookInput } from "../types";
import { consumeBypass } from "../db";

/**
 * Check if command is a blocked git operation
 */
function isBlockedGit(command: string, blocked: RegExp[], allowed: RegExp[]): boolean {
  // First check if it's in allowed list
  if (allowed.some((pattern) => pattern.test(command))) {
    return false;
  }
  // Then check if it's blocked
  return blocked.some((pattern) => pattern.test(command));
}

export async function preBash(
  ctx: HandlerContext,
  input: ClaudeHookInput | OpenCodeHookInput
): Promise<void> {
  const { projectDir, config, client } = ctx;

  // Get command from input
  const command = getCommand(input);
  if (!command) return;

  // Check if it's a blocked git command
  if (isBlockedGit(command, config.blockedPatterns, config.allowedPatterns)) {
    // Check for bypass
    if (consumeBypass(projectDir)) {
      if (client) {
        await client.app.log({
          service: "git-guard",
          level: "warn",
          message: `Bypass git usado para: ${command}`,
        });
      }
      return; // Allow this command
    }

    const error = formatBlockedGitError(command);
    throw new Error(error);
  }

  // Allow the operation
}

function getCommand(input: ClaudeHookInput | OpenCodeHookInput): string {
  // Claude format
  if ("tool_input" in input && input.tool_input) {
    return input.tool_input.command || "";
  }
  // OpenCode format
  if ("args" in input && input.args) {
    return input.args.command || "";
  }
  return "";
}

function formatBlockedGitError(command: string): string {
  return `
${"=".repeat(60)}
GIT GUARD - Blocked Operation
${"=".repeat(60)}

Command: ${command}

Git commits, pushes, and destructive operations must be
performed manually by the user.

Allowed git commands:
  - git status
  - git diff
  - git log
  - git branch
  - git checkout -b
  - git fetch
  - git pull

Tip: Use /bypass-git to allow this command once.
${"=".repeat(60)}
`.trim();
}
