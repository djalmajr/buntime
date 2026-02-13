/**
 * Stop Handler
 * Runs when session is ending - reports status without blocking
 */

import { getActivePlan, getTaskCounts, getTasks } from "../core/plan";
import { incrementStop } from "../core/state";
import type { ClaudeHookInput, ClaudeHookOutput, HandlerContext } from "../types";

export async function stop(
  ctx: HandlerContext,
  _input: ClaudeHookInput,
): Promise<ClaudeHookOutput | void> {
  const { projectDir, config, client } = ctx;

  const plan = getActivePlan(projectDir, config);

  // No active plan - allow stop
  if (!plan) return;

  // Get task counts
  const counts = getTaskCounts(projectDir, config, plan.id);
  const tasks = getTasks(projectDir, config, plan.id);
  const pendingTasks = tasks.filter((t) => !t.done);

  incrementStop(projectDir, config);

  if (counts.pending > 0) {
    // Has pending tasks - warn only
    const tasksList = pendingTasks
      .slice(0, 5)
      .map((t) => `  - ${t.text}`)
      .join("\n");
    const moreText = counts.pending > 5 ? `\n  ... and ${counts.pending - 5} more` : "";

    const message = formatPendingMessage(counts.pending, tasksList, moreText);

    if (client) {
      await client.app.log({
        service: "task-plan",
        level: "warn",
        message,
      });
    }
  } else if (counts.completed > 0) {
    // All tasks done and plan still active
    const message = formatCompletedMessage();

    if (client) {
      await client.app.log({
        service: "task-plan",
        level: "info",
        message,
      });
    }
  }
}

function formatPendingMessage(pendingCount: number, tasksList: string, moreText: string): string {
  return `
${"=".repeat(60)}
Session ending with ${pendingCount} pending task(s)
${"=".repeat(60)}

Pending tasks:
${tasksList}${moreText}

Planning is automatic; this is informational only.
${"=".repeat(60)}
`.trim();
}

function formatCompletedMessage(): string {
  return `
${"=".repeat(60)}
All tasks completed!
${"=".repeat(60)}

Plan can be auto-reused or replaced in the next session.
${"=".repeat(60)}
`.trim();
}
