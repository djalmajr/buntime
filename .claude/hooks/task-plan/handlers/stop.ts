/**
 * Stop Handler
 * Runs when session is ending - blocks if tasks are pending
 */

import type { HandlerContext, ClaudeHookInput, ClaudeHookOutput } from "../types";
import { consumeBypass, incrementStop } from "../core/state";
import { getActivePlan, getTasks, getTaskCounts } from "../core/plan";

export async function stop(
  ctx: HandlerContext,
  _input: ClaudeHookInput
): Promise<ClaudeHookOutput | void> {
  const { projectDir, config, client } = ctx;

  // Check for force-stop bypass first
  if (consumeBypass(projectDir, config, "stop")) {
    if (client) {
      await client.app.log({
        service: "task-plan",
        level: "warn",
        message: "Force stop executed. Pending tasks ignored.",
      });
    }
    return; // Allow stop
  }

  const plan = getActivePlan(projectDir, config);

  // No active plan - allow stop
  if (!plan) return;

  // Get task counts
  const counts = getTaskCounts(projectDir, config, plan.id);
  const tasks = getTasks(projectDir, config, plan.id);
  const pendingTasks = tasks.filter((t) => !t.done);

  // Increment stop attempts
  const stopAttempts = incrementStop(projectDir, config);

  if (counts.pending > 0) {
    // Has pending tasks - block or warn
    const tasksList = pendingTasks
      .slice(0, 5)
      .map((t) => `  - ${t.text}`)
      .join("\n");
    const moreText = counts.pending > 5 ? `\n  ... and ${counts.pending - 5} more` : "";

    if (stopAttempts >= config.maxStopAttempts) {
      // Offer escape hatch
      const message = formatEscapeHatchMessage(counts.pending, tasksList, moreText, stopAttempts);
      
      if (client) {
        await client.app.log({
          service: "task-plan",
          level: "warn",
          message,
        });
      }

      return {
        decision: "block",
        reason: message,
      };
    } else {
      // Normal block
      const message = formatBlockMessage(counts.pending, tasksList, moreText);
      
      if (client) {
        await client.app.log({
          service: "task-plan",
          level: "warn",
          message,
        });
      }

      return {
        decision: "block",
        reason: message,
      };
    }
  } else if (counts.completed > 0) {
    // All tasks done but plan still active
    const message = formatCompletedMessage();
    
    if (client) {
      await client.app.log({
        service: "task-plan",
        level: "info",
        message,
      });
    }

    return {
      decision: "block",
      reason: message,
    };
  }
}

function formatBlockMessage(pendingCount: number, tasksList: string, moreText: string): string {
  return `
${"=".repeat(60)}
STOP BLOCKED: ${pendingCount} task(s) pending
${"=".repeat(60)}

Pending tasks:
${tasksList}${moreText}

Complete the tasks or use /plan done to finish.

Tip: Use /force-stop to exit anyway.
${"=".repeat(60)}
`.trim();
}

function formatEscapeHatchMessage(
  pendingCount: number,
  tasksList: string,
  moreText: string,
  attempts: number
): string {
  return `
${"=".repeat(60)}
STOP BLOCKED: ${pendingCount} task(s) pending
${"=".repeat(60)}

Pending tasks:
${tasksList}${moreText}

You've tried to stop ${attempts} times.

Options:
  1. Complete the pending tasks
  2. Use /plan done to mark as complete
  3. Use /force-stop to exit anyway
${"=".repeat(60)}
`.trim();
}

function formatCompletedMessage(): string {
  return `
${"=".repeat(60)}
All tasks completed!
${"=".repeat(60)}

Next steps:
  1. Run tests if applicable
  2. Use /plan done to mark as complete
  3. Review changes: git status
${"=".repeat(60)}
`.trim();
}
