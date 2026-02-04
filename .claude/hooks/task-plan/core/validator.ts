/**
 * Plan Validator
 * Validate plan format and structure
 */

import type { PlanValidation } from "../types";
import { parseChecklist, parseStatus } from "./parser";

/**
 * Validate plan format
 * Returns errors (blocking) and warnings (informational)
 */
export function validatePlan(content: string): PlanValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required: Status field
  if (!content.includes("**Status:**")) {
    errors.push("Missing **Status:** field (use: Pending, In Progress, or Done)");
  } else {
    const status = parseStatus(content);
    if (!status) {
      errors.push("Invalid status value (use: Pending, In Progress, or Done)");
    }
  }

  // Required: At least one task for activation
  const tasks = parseChecklist(content);
  const pendingTasks = tasks.filter((t) => !t.done);
  
  if (tasks.length === 0) {
    errors.push("No checklist items found (add tasks with - [ ] syntax)");
  }

  // Warning: No pending tasks
  if (tasks.length > 0 && pendingTasks.length === 0) {
    warnings.push("All tasks are completed - consider setting Status: Done");
  }

  // Warning: Recommend Objective section
  if (!content.match(/## (Objective|Objetivo)/i)) {
    warnings.push("Consider adding ## Objective section for clarity");
  }

  // Warning: Check task granularity
  const broadTasks = tasks.filter(
    (t) =>
      t.text.length < 15 || // Very short
      (!t.text.includes("`") && !t.text.match(/\.[a-z]{2,4}$/i)) // No file reference
  );

  if (broadTasks.length > 0 && broadTasks.length === tasks.length) {
    warnings.push(
      "Tasks may be too broad. Consider:\n" +
        "  - Include specific file names in backticks\n" +
        "  - Break large tasks into smaller steps"
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate plan reactivation (Done → In Progress)
 * Returns whether reactivation is allowed and reason
 */
export function validateReactivation(
  oldContent: string,
  newContent: string
): { allowed: boolean; reason: string } {
  const oldStatus = parseStatus(oldContent);
  const newStatus = parseStatus(newContent);

  // Not a reactivation
  if (oldStatus !== "Done" || newStatus !== "In Progress") {
    return { allowed: true, reason: "" };
  }

  // Reactivation: Done → In Progress
  const newTasks = parseChecklist(newContent);
  const hasPendingTasks = newTasks.some((t) => !t.done);

  // Case 1: Has pending tasks → ALLOW (adjustments)
  if (hasPendingTasks) {
    const pendingCount = newTasks.filter((t) => !t.done).length;
    return {
      allowed: true,
      reason: `Plan reactivated with ${pendingCount} pending task(s).`,
    };
  }

  // Case 2: All tasks done, check if same files
  const oldTasks = parseChecklist(oldContent);
  const oldFiles = extractFilePaths(oldTasks);
  const newFiles = extractFilePaths(newTasks);

  const sameFiles =
    oldFiles.length > 0 &&
    newFiles.length > 0 &&
    newFiles.every((f) => oldFiles.includes(f)) &&
    oldFiles.every((f) => newFiles.includes(f));

  if (sameFiles) {
    return {
      allowed: true,
      reason: "Plan reactivated for adjustments to same files.",
    };
  }

  // Case 3: Different files without pending tasks → BLOCK
  return {
    allowed: false,
    reason:
      "Cannot reactivate completed plan for different scope.\n\n" +
      "To work on different files, create a new plan with pending tasks.",
  };
}

/**
 * Extract file paths from task texts
 */
function extractFilePaths(tasks: { text: string }[]): string[] {
  const regex = /`([^`]+\.[a-zA-Z0-9]+)`/g;
  const files: string[] = [];

  for (const task of tasks) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(task.text)) !== null) {
      if (!files.includes(match[1])) {
        files.push(match[1]);
      }
    }
  }

  return files;
}
