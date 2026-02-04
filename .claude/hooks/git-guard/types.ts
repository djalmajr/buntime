/**
 * Git Guard Types
 */

export interface GitGuardConfig {
  blockedPatterns: RegExp[];
  allowedPatterns: RegExp[];
}

export interface HandlerContext {
  projectDir: string;
  config: GitGuardConfig;
  client?: {
    app: {
      log: (opts: { service: string; level: string; message: string }) => Promise<void>;
    };
  };
}

export interface ClaudeHookInput {
  session_id?: string;
  tool_name?: string;
  tool_input?: {
    command?: string;
    [key: string]: unknown;
  };
}

export interface OpenCodeHookInput {
  tool: string;
  args?: {
    command?: string;
    [key: string]: unknown;
  };
}
