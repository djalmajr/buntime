/**
 * Session Start Handler
 * Runs when a session begins - loads state and shows context
 */

import type { HandlerContext, ClaudeHookInput, Plan, Task } from "../types";
import { getActivePlan, getTasks, getTaskCounts, listPlans } from "../core/plan";
import { getDb } from "../core/db";

export async function sessionStart(
  ctx: HandlerContext,
  _input: ClaudeHookInput
): Promise<string> {
  const { projectDir, config, client } = ctx;
  
  // Initialize database (creates if not exists)
  getDb(projectDir, config.dbFile);

  // Reset stop attempts on new session
  const plan = getActivePlan(projectDir, config);
  
  if (plan) {
    // Reset stop attempts
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

  // No active plan - show instructions
  const existingPlans = listPlans(projectDir, config);
  const pendingPlans = existingPlans.filter(p => p.status === "Pending");

  const message = formatNoPlanMessage(pendingPlans);

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
  counts: { total: number; completed: number; pending: number }
): string {
  const lines = [
    "",
    "=".repeat(60),
    "PLANNING ENFORCER - Active Plan",
    "=".repeat(60),
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
  lines.push("Use TodoWrite with task IDs to track progress.");
  lines.push("Commands: /plan, /plan-list, /plan-done");
  lines.push("=".repeat(60));
  lines.push("");

  return lines.join("\n");
}

function formatNoPlanMessage(pendingPlans: Plan[]): string {
  const lines = [
    "",
    "=".repeat(60),
    "PLANNING ENFORCER - No Active Plan",
    "=".repeat(60),
    "",
    "Before modifying files, create a plan using /plan-new",
    "",
    "Or activate an existing plan with:",
    "  bun run .claude/hooks/planning/cli.ts activate <plan-id>",
    "",
  ];

  if (pendingPlans.length > 0) {
    lines.push("Pending plans:");
    for (const plan of pendingPlans.slice(0, 5)) {
      lines.push(`  - ${plan.id}: ${plan.summary}`);
    }
    if (pendingPlans.length > 5) {
      lines.push(`  ... and ${pendingPlans.length - 5} more`);
    }
    lines.push("");
  }

  lines.push("Exempt from planning: .claude/*, .opencode/*, test files, .env*");
  lines.push("=".repeat(60));
  lines.push("");

  return lines.join("\n");
}
