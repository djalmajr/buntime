/**
 * SQLite Database Layer
 * Manages plans and tasks storage
 */

import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Plan, Task, PlanStatus, BypassType } from "../types";

let db: Database | null = null;

/**
 * Get or create database connection
 */
export function getDb(projectDir: string, dbPath: string): Database {
  if (db) return db;

  const fullPath = join(projectDir, dbPath);
  
  // Ensure directory exists
  const dir = dirname(fullPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(fullPath);
  db.exec("PRAGMA foreign_keys = ON");
  
  // Run migrations
  migrate(db);
  
  return db;
}

/**
 * Close database connection
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Run database migrations
 */
function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'In Progress', 'Done')),
      modified_files TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      is_active INTEGER DEFAULT 0,
      stop_attempts INTEGER DEFAULT 0,
      bypass_plan INTEGER DEFAULT 0,
      bypass_git INTEGER DEFAULT 0,
      force_stop INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      text TEXT NOT NULL,
      done INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_plan_id ON tasks(plan_id);
    CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
    CREATE INDEX IF NOT EXISTS idx_plans_is_active ON plans(is_active);
  `);
}

// =============================================================================
// Plan Operations
// =============================================================================

/**
 * Create a new plan
 */
export function createPlan(
  db: Database,
  id: string,
  title: string,
  summary: string,
  description: string,
  tasks?: string[]
): Plan {
  const stmt = db.prepare(`
    INSERT INTO plans (id, title, summary, description, status)
    VALUES (?, ?, ?, ?, 'Pending')
  `);
  stmt.run(id, title, summary, description);

  // Add tasks if provided
  if (tasks && tasks.length > 0) {
    const taskStmt = db.prepare(`
      INSERT INTO tasks (plan_id, position, text)
      VALUES (?, ?, ?)
    `);
    tasks.forEach((text, index) => {
      taskStmt.run(id, index + 1, text);
    });
  }

  return getPlan(db, id)!;
}

/**
 * Get a plan by ID
 */
export function getPlan(db: Database, id: string): Plan | null {
  const row = db.prepare(`SELECT * FROM plans WHERE id = ?`).get(id) as PlanRow | null;
  if (!row) return null;
  return rowToPlan(row);
}

/**
 * Get the active plan
 */
export function getActivePlan(db: Database): Plan | null {
  const row = db.prepare(`SELECT * FROM plans WHERE is_active = 1`).get() as PlanRow | null;
  if (!row) return null;
  return rowToPlan(row);
}

/**
 * List all plans with optional status filter
 */
export function listPlans(db: Database, status?: PlanStatus): Plan[] {
  let query = `SELECT * FROM plans`;
  const params: string[] = [];
  
  if (status) {
    query += ` WHERE status = ?`;
    params.push(status);
  }
  
  query += ` ORDER BY updated_at DESC`;
  
  const rows = db.prepare(query).all(...params) as PlanRow[];
  return rows.map(rowToPlan);
}

/**
 * Update a plan
 */
export function updatePlan(
  db: Database,
  id: string,
  updates: Partial<Pick<Plan, 'title' | 'summary' | 'description' | 'status' | 'modifiedFiles'>>
): Plan | null {
  const fields: string[] = ['updated_at = datetime(\'now\')'];
  const values: (string | null)[] = [];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
  }
  if (updates.summary !== undefined) {
    fields.push('summary = ?');
    values.push(updates.summary);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
    if (updates.status === 'Done') {
      fields.push('completed_at = datetime(\'now\')');
      fields.push('is_active = 0');
    }
  }
  if (updates.modifiedFiles !== undefined) {
    fields.push('modified_files = ?');
    values.push(JSON.stringify(updates.modifiedFiles));
  }

  values.push(id);
  db.prepare(`UPDATE plans SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  
  return getPlan(db, id);
}

/**
 * Activate a plan (deactivates any other active plan)
 */
export function activatePlan(db: Database, id: string): Plan | null {
  db.exec(`UPDATE plans SET is_active = 0, bypass_plan = 0, force_stop = 0`);
  db.prepare(`
    UPDATE plans 
    SET is_active = 1, status = 'In Progress', stop_attempts = 0, updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
  return getPlan(db, id);
}

/**
 * Deactivate the active plan
 */
export function deactivatePlan(db: Database): void {
  db.exec(`UPDATE plans SET is_active = 0 WHERE is_active = 1`);
}

/**
 * Delete a plan
 */
export function deletePlan(db: Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM plans WHERE id = ?`).run(id);
  return result.changes > 0;
}

// =============================================================================
// Task Operations
// =============================================================================

/**
 * Get tasks for a plan
 */
export function getTasks(db: Database, planId: string): Task[] {
  const rows = db.prepare(`
    SELECT * FROM tasks WHERE plan_id = ? ORDER BY position
  `).all(planId) as TaskRow[];
  return rows.map(rowToTask);
}

/**
 * Add a task to a plan
 */
export function addTask(db: Database, planId: string, text: string, position?: number): Task {
  // Get max position if not specified
  if (position === undefined) {
    const max = db.prepare(`SELECT MAX(position) as max FROM tasks WHERE plan_id = ?`).get(planId) as { max: number | null };
    position = (max.max || 0) + 1;
  }

  const result = db.prepare(`
    INSERT INTO tasks (plan_id, position, text)
    VALUES (?, ?, ?)
  `).run(planId, position, text);

  return getTask(db, Number(result.lastInsertRowid))!;
}

/**
 * Get a task by ID
 */
export function getTask(db: Database, id: number): Task | null {
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as TaskRow | null;
  if (!row) return null;
  return rowToTask(row);
}

/**
 * Update a task
 */
export function updateTask(
  db: Database,
  id: number,
  updates: Partial<Pick<Task, 'text' | 'done' | 'position'>>
): Task | null {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.text !== undefined) {
    fields.push('text = ?');
    values.push(updates.text);
  }
  if (updates.done !== undefined) {
    fields.push('done = ?');
    values.push(updates.done ? 1 : 0);
    if (updates.done) {
      fields.push('completed_at = datetime(\'now\')');
    } else {
      fields.push('completed_at = NULL');
    }
  }
  if (updates.position !== undefined) {
    fields.push('position = ?');
    values.push(updates.position);
  }

  if (fields.length === 0) return getTask(db, id);

  values.push(id);
  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  
  // Update plan's updated_at
  const task = getTask(db, id);
  if (task) {
    db.prepare(`UPDATE plans SET updated_at = datetime('now') WHERE id = ?`).run(task.planId);
  }
  
  return task;
}

/**
 * Mark a task as done/undone
 */
export function setTaskDone(db: Database, id: number, done: boolean): Task | null {
  return updateTask(db, id, { done });
}

/**
 * Delete a task
 */
export function deleteTask(db: Database, id: number): boolean {
  const result = db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
  return result.changes > 0;
}

/**
 * Get task counts for a plan
 */
export function getTaskCounts(db: Database, planId: string): { total: number; completed: number; pending: number } {
  const row = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END) as completed
    FROM tasks WHERE plan_id = ?
  `).get(planId) as { total: number; completed: number };
  
  return {
    total: row.total || 0,
    completed: row.completed || 0,
    pending: (row.total || 0) - (row.completed || 0),
  };
}

// =============================================================================
// State Operations (for bypass flags, etc.)
// =============================================================================

/**
 * Set a bypass flag on the active plan
 */
export function setBypass(db: Database, type: BypassType): boolean {
  const column = type === 'plan' ? 'bypass_plan' : 'force_stop';
  const result = db.prepare(`UPDATE plans SET ${column} = 1 WHERE is_active = 1`).run();
  return result.changes > 0;
}

/**
 * Consume (check and reset) a bypass flag
 */
export function consumeBypass(db: Database, type: BypassType): boolean {
  const column = type === 'plan' ? 'bypass_plan' : 'force_stop';
  
  const plan = getActivePlan(db);
  if (!plan) return false;
  
  const wasSet = type === 'plan' ? plan.bypassPlan : plan.forceStop;
  
  if (wasSet) {
    db.prepare(`UPDATE plans SET ${column} = 0 WHERE is_active = 1`).run();
  }
  
  return wasSet;
}

/**
 * Increment stop attempts
 */
export function incrementStopAttempts(db: Database): number {
  db.exec(`UPDATE plans SET stop_attempts = stop_attempts + 1 WHERE is_active = 1`);
  const plan = getActivePlan(db);
  return plan?.stopAttempts || 0;
}

/**
 * Add a modified file to the active plan
 */
export function addModifiedFile(db: Database, filePath: string): void {
  const plan = getActivePlan(db);
  if (!plan) return;
  
  if (!plan.modifiedFiles.includes(filePath)) {
    const files = [...plan.modifiedFiles, filePath];
    db.prepare(`UPDATE plans SET modified_files = ? WHERE id = ?`).run(JSON.stringify(files), plan.id);
  }
}

// =============================================================================
// Type Conversions
// =============================================================================

interface PlanRow {
  id: string;
  title: string;
  summary: string;
  description: string;
  status: string;
  modified_files: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  is_active: number;
  stop_attempts: number;
  bypass_plan: number;
  force_stop: number;
}

interface TaskRow {
  id: number;
  plan_id: string;
  position: number;
  text: string;
  done: number;
  created_at: string;
  completed_at: string | null;
}

function rowToPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    description: row.description,
    status: row.status as PlanStatus,
    modifiedFiles: JSON.parse(row.modified_files || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || undefined,
    isActive: row.is_active === 1,
    stopAttempts: row.stop_attempts,
    bypassPlan: row.bypass_plan === 1,
    forceStop: row.force_stop === 1,
  };
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    planId: row.plan_id,
    position: row.position,
    text: row.text,
    done: row.done === 1,
    createdAt: row.created_at,
    completedAt: row.completed_at || undefined,
  };
}
