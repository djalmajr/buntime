/**
 * Todo Updated Handler
 * Runs when TodoWrite is used - syncs todos with plan checklist
 *
 * Todo IDs map to task IDs in the SQLite database.
 */

import { loadActivePlan } from "../core/state";
import { syncTodos } from "../core/sync";
import type { HandlerContext, TodoEvent } from "../types";

export async function todoUpdated(ctx: HandlerContext, event: TodoEvent): Promise<void> {
  const { projectDir, config, client } = ctx;

  const todos = event.todos || [];
  if (todos.length === 0) return;

  const plan = loadActivePlan(projectDir, config);
  if (!plan) return;

  // Sync todos with plan using task IDs
  const { synced, pending, completed } = syncTodos(projectDir, config, todos);

  if (synced > 0) {
    const message = `Plan synced: ${completed} completed, ${pending} pending`;

    if (client) {
      await client.app.log({
        service: "task-plan",
        level: "info",
        message,
      });
    }

    console.error(message);
  }

  // Check if all tasks are done
  if (pending === 0 && completed > 0) {
    const message = `All tasks completed!\n\nNext steps:\n1. Run tests\n2. Review changes with: git status\n3. Continue or end the session (planning lifecycle is automatic)`;

    if (client) {
      await client.app.log({
        service: "task-plan",
        level: "info",
        message,
      });
    }
  }
}
