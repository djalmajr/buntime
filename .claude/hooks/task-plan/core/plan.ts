/**
 * Plan Operations (SQLite wrapper)
 * Provides functions for managing plans and tasks
 */

import type { TaskPlanConfig, Plan, Task, PlanStatus } from "../types";
import {
  getDb,
  createPlan as dbCreatePlan,
  getPlan as dbGetPlan,
  getActivePlan as dbGetActivePlan,
  listPlans as dbListPlans,
  updatePlan as dbUpdatePlan,
  activatePlan as dbActivatePlan,
  deactivatePlan as dbDeactivatePlan,
  deletePlan as dbDeletePlan,
  getTasks as dbGetTasks,
  addTask as dbAddTask,
  getTask as dbGetTask,
  updateTask as dbUpdateTask,
  setTaskDone as dbSetTaskDone,
  deleteTask as dbDeleteTask,
  getTaskCounts as dbGetTaskCounts,
} from "./db";

// =============================================================================
// Plan Operations
// =============================================================================

/**
 * Create a new plan
 */
export function createPlan(
  projectDir: string,
  config: TaskPlanConfig,
  id: string,
  title: string,
  summary: string,
  description: string,
  tasks?: string[]
): Plan {
  const db = getDb(projectDir, config.dbFile);
  return dbCreatePlan(db, id, title, summary, description, tasks);
}

/**
 * Get a plan by ID
 */
export function getPlan(
  projectDir: string,
  config: TaskPlanConfig,
  id: string
): Plan | null {
  const db = getDb(projectDir, config.dbFile);
  return dbGetPlan(db, id);
}

/**
 * Get the active plan
 */
export function getActivePlan(
  projectDir: string,
  config: TaskPlanConfig
): Plan | null {
  const db = getDb(projectDir, config.dbFile);
  return dbGetActivePlan(db);
}

/**
 * List all plans, optionally filtered by status
 */
export function listPlans(
  projectDir: string,
  config: TaskPlanConfig,
  status?: PlanStatus
): Plan[] {
  const db = getDb(projectDir, config.dbFile);
  return dbListPlans(db, status);
}

/**
 * Update a plan
 */
export function updatePlan(
  projectDir: string,
  config: TaskPlanConfig,
  id: string,
  updates: Partial<Pick<Plan, 'title' | 'summary' | 'description' | 'status' | 'modifiedFiles'>>
): Plan | null {
  const db = getDb(projectDir, config.dbFile);
  return dbUpdatePlan(db, id, updates);
}

/**
 * Activate a plan (sets it to "In Progress" and marks it as active)
 */
export function activatePlan(
  projectDir: string,
  config: TaskPlanConfig,
  id: string
): Plan | null {
  const db = getDb(projectDir, config.dbFile);
  return dbActivatePlan(db, id);
}

/**
 * Deactivate the current active plan
 */
export function deactivatePlan(
  projectDir: string,
  config: TaskPlanConfig
): void {
  const db = getDb(projectDir, config.dbFile);
  dbDeactivatePlan(db);
}

/**
 * Mark a plan as done
 */
export function completePlan(
  projectDir: string,
  config: TaskPlanConfig,
  id: string
): Plan | null {
  const db = getDb(projectDir, config.dbFile);
  return dbUpdatePlan(db, id, { status: "Done" });
}

/**
 * Delete a plan
 */
export function deletePlan(
  projectDir: string,
  config: TaskPlanConfig,
  id: string
): boolean {
  const db = getDb(projectDir, config.dbFile);
  return dbDeletePlan(db, id);
}

// =============================================================================
// Task Operations
// =============================================================================

/**
 * Get tasks for a plan
 */
export function getTasks(
  projectDir: string,
  config: TaskPlanConfig,
  planId: string
): Task[] {
  const db = getDb(projectDir, config.dbFile);
  return dbGetTasks(db, planId);
}

/**
 * Add a task to a plan
 */
export function addTask(
  projectDir: string,
  config: TaskPlanConfig,
  planId: string,
  text: string,
  position?: number
): Task {
  const db = getDb(projectDir, config.dbFile);
  return dbAddTask(db, planId, text, position);
}

/**
 * Get a task by ID
 */
export function getTask(
  projectDir: string,
  config: TaskPlanConfig,
  id: number
): Task | null {
  const db = getDb(projectDir, config.dbFile);
  return dbGetTask(db, id);
}

/**
 * Update a task
 */
export function updateTask(
  projectDir: string,
  config: TaskPlanConfig,
  id: number,
  updates: Partial<Pick<Task, 'text' | 'done' | 'position'>>
): Task | null {
  const db = getDb(projectDir, config.dbFile);
  return dbUpdateTask(db, id, updates);
}

/**
 * Mark a task as done or undone
 */
export function setTaskDone(
  projectDir: string,
  config: TaskPlanConfig,
  id: number,
  done: boolean
): Task | null {
  const db = getDb(projectDir, config.dbFile);
  return dbSetTaskDone(db, id, done);
}

/**
 * Delete a task
 */
export function deleteTask(
  projectDir: string,
  config: TaskPlanConfig,
  id: number
): boolean {
  const db = getDb(projectDir, config.dbFile);
  return dbDeleteTask(db, id);
}

/**
 * Get task counts for a plan
 */
export function getTaskCounts(
  projectDir: string,
  config: TaskPlanConfig,
  planId: string
): { total: number; completed: number; pending: number } {
  const db = getDb(projectDir, config.dbFile);
  return dbGetTaskCounts(db, planId);
}

/**
 * Check if all tasks in the active plan are completed
 */
export function areAllTasksCompleted(
  projectDir: string,
  config: TaskPlanConfig
): boolean {
  const plan = getActivePlan(projectDir, config);
  if (!plan) return false;
  
  const counts = getTaskCounts(projectDir, config, plan.id);
  return counts.total > 0 && counts.pending === 0;
}
