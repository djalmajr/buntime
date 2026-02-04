/**
 * Pre Tool Use Handler (Edit|Write)
 * Runs before file modifications - blocks without active plan
 */

import type { HandlerContext, ClaudeHookInput, OpenCodeHookInput } from "../types";
import { consumeBypass } from "../core/state";
import { getActivePlan, getTasks } from "../core/plan";
import { isExempt } from "../core/parser";

export async function preToolUse(
  ctx: HandlerContext,
  input: ClaudeHookInput | OpenCodeHookInput
): Promise<void> {
  const { projectDir, config, client } = ctx;

  // Normalize input (Claude vs OpenCode format)
  const filePath = getFilePath(input);
  if (!filePath) return; // No file path, not a file operation

  const relativePath = normalizeRelativePath(filePath, projectDir);

  // Check if file is exempt from planning requirement
  if (isExempt(filePath, projectDir, config.exemptPatterns)) {
    return; // Allow exempt files
  }

  // Check for active plan
  const plan = getActivePlan(projectDir, config);

  if (!plan) {
    // Check for bypass
    if (consumeBypass(projectDir, config, "plan")) {
      if (client) {
        await client.app.log({
          service: "task-plan",
          level: "warn",
          message: `Bypass usado para: ${relativePath}`,
        });
      }
      return; // Allow this operation
    }

    const error = formatNoPlanError(relativePath);
    throw new Error(error);
  }

  // Warn if file not in plan (optional)
  if (config.warnOnUnexpectedFiles) {
    const tasks = getTasks(projectDir, config, plan.id);
    const expectedFiles = extractFilesFromTasks(tasks.map(t => t.text));
    
    if (expectedFiles.length > 0 && !isFileExpected(filePath, expectedFiles)) {
      const warning = `File not referenced in active plan checklist:\n  - ${relativePath}\n\nConsider updating the plan to include this file.`;
      
      if (client) {
        await client.app.log({
          service: "task-plan",
          level: "warn",
          message: warning,
        });
      }
    }
  }

  // Allow the operation
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

function normalizeRelativePath(filePath: string, projectDir: string): string {
  let relativePath = filePath.replace(/\\/g, "/");
  const normalizedProjectDir = projectDir.replace(/\\/g, "/");

  if (relativePath.startsWith(normalizedProjectDir)) {
    relativePath = relativePath.slice(normalizedProjectDir.length).replace(/^\//, "");
  }

  return relativePath;
}

function formatNoPlanError(filePath: string): string {
  return `
${"=".repeat(60)}
BLOCKED: No active plan
${"=".repeat(60)}

File: ${filePath}

Create a plan first with /plan new
Or activate an existing plan with /plan activate <id>

Tip: Use /bypass-plan to allow this operation once.
${"=".repeat(60)}
`.trim();
}

/**
 * Extract file paths from task texts (from backticks)
 */
function extractFilesFromTasks(texts: string[]): string[] {
  const files: string[] = [];
  const regex = /\`([^`]+\.[a-zA-Z0-9]+)\`/g;
  
  for (const text of texts) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      files.push(match[1]);
    }
  }
  
  return [...new Set(files)]; // unique
}

/**
 * Check if a file matches any expected file from plan
 */
function isFileExpected(filePath: string, expectedFiles: string[]): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  return expectedFiles.some(
    (f) => normalizedPath.endsWith(f) || normalizedPath.includes(f)
  );
}
