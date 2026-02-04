/**
 * Post Tool Use Handler
 * Runs lint check after file edits
 */

import type { HandlerContext, ClaudeHookInput, OpenCodeHookInput, CheckResult } from "../types";
import { runLint } from "../checkers/lint";

/**
 * Handle post-tool-use hook
 * Runs lint on edited files and reports warnings/errors
 */
export async function postToolUse(
  ctx: HandlerContext,
  input: ClaudeHookInput | OpenCodeHookInput
): Promise<void> {
  const { projectDir, config, client } = ctx;

  if (!config.lintEnabled) return;

  // Get file path from input
  const filePath = getFilePath(input);
  if (!filePath) return;

  // Run lint
  const result = await runLint(projectDir, filePath, config);

  // Report results
  if (result && !result.success) {
    await reportResult(result, client);
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

async function reportResult(
  result: CheckResult,
  client?: HandlerContext["client"]
): Promise<void> {
  if (!client) {
    // Console output for standalone testing
    if (result.errors.length > 0) {
      console.warn(`\n⚠️  Lint ${result.checker} found ${result.errors.length} error(s):`);
      result.errors.forEach((e) => console.warn(`  - ${e}`));
    }
    if (result.warnings.length > 0) {
      console.warn(`\n⚠️  Lint ${result.checker} found ${result.warnings.length} warning(s):`);
      result.warnings.forEach((w) => console.warn(`  - ${w}`));
    }
    return;
  }

  // Log via client
  if (result.errors.length > 0) {
    await client.app.log({
      service: "code-quality",
      level: "warn",
      message: `Lint errors (${result.errors.length}): ${result.errors.slice(0, 3).join("; ")}`,
    });
  }
}
