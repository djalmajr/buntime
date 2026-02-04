/**
 * Post Tool Use Handler (Edit|Write)
 * Runs after file modifications - tracks modified files
 */

import type { HandlerContext, ClaudeHookInput, OpenCodeHookInput } from "../types";
import { trackModifiedFile } from "../core/sync";
import { getActivePlan } from "../core/plan";

export async function postToolUse(
  ctx: HandlerContext,
  input: ClaudeHookInput | OpenCodeHookInput
): Promise<void> {
  const { projectDir, config } = ctx;

  // Get file path from input
  const filePath = getFilePath(input);
  if (!filePath) return;

  // Track modified file if there's an active plan
  const plan = getActivePlan(projectDir, config);
  if (plan) {
    trackModifiedFile(projectDir, config, filePath);
  }
}

function getFilePath(input: ClaudeHookInput | OpenCodeHookInput): string {
  // Claude format
  if ("tool_input" in input && input.tool_input) {
    return input.tool_input.file_path || input.tool_input.filePath || "";
  }
  // OpenCode format
  if ("args" in input && input.args) {
    return input.args.filePath || "";
  }
  return "";
}
