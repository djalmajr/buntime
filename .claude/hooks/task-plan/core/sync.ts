/**
 * Todo Sync
 * Synchronize TodoWrite tasks with SQLite database
 * 
 * TodoWrite IDs map to task IDs in the database.
 */

import type { TaskPlanConfig } from "../types";
import {
  getActivePlan,
  getTasks,
  setTaskDone,
  getTaskCounts,
} from "./plan";
import { addModifiedFile as stateAddModifiedFile } from "./state";

/**
 * Sync a single todo item to the database
 * Uses the todo ID (task ID) for matching
 */
export function syncTodoToPlan(
  projectDir: string,
  config: TaskPlanConfig,
  todoId: string,
  completed: boolean
): boolean {
  const taskId = parseInt(todoId, 10);
  if (isNaN(taskId)) return false;

  const task = setTaskDone(projectDir, config, taskId, completed);
  return task !== null;
}

/**
 * Sync multiple todos at once
 * Returns sync statistics
 */
export function syncTodos(
  projectDir: string,
  config: TaskPlanConfig,
  todos: Array<{ id?: string; content: string; status: string }>
): { synced: number; pending: number; completed: number } {
  const plan = getActivePlan(projectDir, config);
  if (!plan) {
    return { synced: 0, pending: 0, completed: 0 };
  }

  let synced = 0;

  // Get current tasks to compare
  const currentTasks = getTasks(projectDir, config, plan.id);
  const tasksById = new Map(currentTasks.map((t) => [t.id, t]));

  for (const todo of todos) {
    // Skip if no ID
    if (!todo.id) continue;

    const taskId = parseInt(todo.id, 10);
    if (isNaN(taskId)) continue;

    const completed = todo.status === "completed" || todo.status === "cancelled";
    const currentTask = tasksById.get(taskId);

    // Only sync if status changed
    if (currentTask && currentTask.done !== completed) {
      if (setTaskDone(projectDir, config, taskId, completed)) {
        synced++;
      }
    }
  }

  // Get updated counts
  const counts = getTaskCounts(projectDir, config, plan.id);

  return { synced, pending: counts.pending, completed: counts.completed };
}

/**
 * Track a modified file in the active plan
 */
export function trackModifiedFile(
  projectDir: string,
  config: TaskPlanConfig,
  filePath: string
): void {
  // Normalize path
  let relativePath = filePath.replace(/\\/g, "/");
  const normalizedProjectDir = projectDir.replace(/\\/g, "/");

  if (relativePath.startsWith(normalizedProjectDir)) {
    relativePath = relativePath
      .slice(normalizedProjectDir.length)
      .replace(/^\//, "");
  }

  stateAddModifiedFile(projectDir, config, relativePath);
}
