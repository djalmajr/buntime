/**
 * Plan Parser
 * Parse markdown plan files for status and checklist items
 */

import type { PlanStatus } from "../types";

/**
 * Parsed task from markdown (internal type, not the DB Task)
 */
interface ParsedTask {
  text: string;
  done: boolean;
  line: number;
}

/**
 * Parse checklist items from plan markdown content
 */
export function parseChecklist(content: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  const lines = content.split("\n");

  lines.forEach((line, index) => {
    // Match: - [ ] text or - [x] text or - [X] text
    const match = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
    if (match) {
      tasks.push({
        text: match[2].trim(),
        done: match[1].toLowerCase() === "x",
        line: index + 1,
      });
    }
  });

  return tasks;
}

/**
 * Parse status from plan content
 * Looks for: **Status:** Pending|In Progress|Done
 */
export function parseStatus(content: string): PlanStatus | null {
  const match = content.match(/\*\*Status:\*\*\s*(Pending|In Progress|Done)/i);
  if (match) {
    // Normalize case
    const status = match[1].toLowerCase();
    if (status === "pending") return "Pending";
    if (status === "in progress") return "In Progress";
    if (status === "done") return "Done";
  }
  return null;
}

/**
 * Check if a file path is a plan file
 */
export function isPlanFile(filePath: string, plansDir: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedPlansDir = plansDir.replace(/\\/g, "/");
  return normalizedPath.includes(normalizedPlansDir) && normalizedPath.endsWith(".md");
}

/**
 * Check if a file path is exempt from planning requirement
 */
export function isExempt(filePath: string, projectDir: string, patterns: RegExp[]): boolean {
  // Normalize and get relative path
  let relativePath = filePath.replace(/\\/g, "/");
  const normalizedProjectDir = projectDir.replace(/\\/g, "/");

  if (relativePath.startsWith(normalizedProjectDir)) {
    relativePath = relativePath.slice(normalizedProjectDir.length).replace(/^\//, "");
  }

  // Check against exempt patterns
  return patterns.some((pattern) => pattern.test(relativePath));
}

/**
 * Extract file paths from checklist item text (from backticks)
 */
export function extractFilesFromItem(text: string): string[] {
  const regex = /`([^`]+\.[a-zA-Z0-9]+)`/g;
  const files: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    files.push(match[1]);
  }
  return files;
}

/**
 * Get all expected files from active plan's tasks
 */
export function getExpectedFiles(tasks: { text: string }[]): string[] {
  return tasks
    .flatMap((task) => extractFilesFromItem(task.text))
    .filter((f, i, arr) => arr.indexOf(f) === i); // unique
}

/**
 * Check if a file matches any expected file from plan
 */
export function isFileExpected(filePath: string, expectedFiles: string[]): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  return expectedFiles.some(
    (f) => normalizedPath.endsWith(f) || normalizedPath.includes(f)
  );
}
