/**
 * Session Start Handler
 * Runs when a session begins - loads state and shows context
 */

import { getDb } from "../core/db";
import { getActivePlan, getTaskCounts, getTasks } from "../core/plan";
import type { ClaudeHookInput, HandlerContext, Plan, Task } from "../types";

export async function sessionStart(ctx: HandlerContext, _input: ClaudeHookInput): Promise<string> {
  const { projectDir, config, client } = ctx;

  // Initialize database (creates if not exists)
  getDb(projectDir, config.dbFile);

  const plan = getActivePlan(projectDir, config);

  if (!plan) {
    const message = formatNoActivePlanMessage();

    if (client) {
      await client.app.log({
        service: "task-plan",
        level: "info",
        message,
      });
    }

    return message;
  }

  // Reset stop attempts on new session
  const db = getDb(projectDir, config.dbFile);
  db.prepare(`UPDATE plans SET stop_attempts = 0 WHERE id = ?`).run(plan.id);

  const tasks = getTasks(projectDir, config, plan.id);
  const counts = getTaskCounts(projectDir, config, plan.id);
  const message = formatActivePlanMessage(plan, tasks, counts);

  if (client) {
    await client.app.log({
      service: "task-plan",
      level: "info",
      message,
    });
  }

  return message;
}

function formatActivePlanMessage(
  plan: Plan,
  tasks: Task[],
  counts: { total: number; completed: number; pending: number },
): string {
  const lines = [
    "",
    "=".repeat(60),
    "PLANNING ENFORCER - Automatic Plan",
    "=".repeat(60),
    `Auto-plan active: "${plan.id}"`,
    "",
    `# ${plan.title}`,
    "",
    `**TL;DR:** ${plan.summary}`,
    "",
    `**Progress:** ${counts.completed}/${counts.total} tasks completed`,
    "",
  ];

  if (tasks.length > 0) {
    lines.push("## Tasks");
    for (const task of tasks) {
      const status = task.done ? "[x]" : "[ ]";
      lines.push(`  ${status} [id:${task.id}] ${task.text}`);
    }
    lines.push("");
  }

  lines.push("## Description");
  lines.push(plan.description);
  lines.push("");

  lines.push("-".repeat(60));
  lines.push("Planning is automatic. No manual /plan commands are required.");
  lines.push("Use TodoWrite normally; progress sync is automatic.");
  lines.push("=".repeat(60));
  lines.push("");

  return lines.join("\n");
}

function formatNoActivePlanMessage(): string {
  return [
    "",
    "=".repeat(60),
    "PLANNING ENFORCER - Automatic Plan",
    "=".repeat(60),
    "No active plan yet.",
    "A plan will be created or reused automatically from your next prompt context.",
    "Fallback: the first file edit also triggers automatic plan resolution.",
    "=".repeat(60),
    "",
  ].join("\n");
}
