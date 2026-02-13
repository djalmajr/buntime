/**
 * Task Plan Types
 * Shared types for Claude Code and OpenCode integration
 */

// =============================================================================
// Plan & Task Types (SQLite)
// =============================================================================

export type PlanStatus = "Pending" | "In Progress" | "Done";

export interface Plan {
  id: string;
  title: string;
  summary: string;
  description: string;
  status: PlanStatus;
  modifiedFiles: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  isActive: boolean;
  stopAttempts: number;
  bypassPlan: boolean;
  forceStop: boolean;
}

export interface Task {
  id: number;
  planId: string;
  position: number;
  text: string;
  done: boolean;
  createdAt: string;
  completedAt?: string;
}

export type BypassType = "plan" | "stop";

// =============================================================================
// Configuration Types
// =============================================================================

export interface TaskPlanConfig {
  dbFile: string;
  exemptPatterns: RegExp[];
  warnOnUnexpectedFiles: boolean;
  maxStopAttempts: number;
}

// =============================================================================
// Handler Context
// =============================================================================

export interface HandlerContext {
  projectDir: string;
  config: TaskPlanConfig;
  // OpenCode specific - optional client for logging
  client?: {
    app: {
      log: (opts?: unknown) => unknown;
    };
  };
}

// =============================================================================
// Hook Input Types
// =============================================================================

export interface ClaudeHookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  permission_mode?: string;
  hook_event_name?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    filePath?: string;
    command?: string;
    content?: string;
    [key: string]: unknown;
  };
  tool_use_id?: string;
}

export interface OpenCodeHookInput {
  tool: string;
  args?: {
    filePath?: string;
    command?: string;
    content?: string;
    [key: string]: unknown;
  };
}

export interface TodoEvent {
  todos?: Array<{
    id?: string;
    content: string;
    status: string;
    priority?: string;
  }>;
}

// =============================================================================
// Hook Output Types
// =============================================================================

export interface ClaudeHookOutput {
  hookSpecificOutput?: {
    hookEventName: string;
    permissionDecision?: "allow" | "deny" | "ask";
    permissionDecisionReason?: string;
    additionalContext?: string;
  };
  continue?: boolean;
  stopReason?: string;
  decision?: "block";
  reason?: string;
}

// =============================================================================
// Validation Types
// =============================================================================

export interface PlanValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
