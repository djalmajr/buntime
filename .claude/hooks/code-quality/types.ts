/**
 * Code Quality Hook Types
 */

export interface CodeQualityConfig {
  // Enable/disable checkers
  lintEnabled: boolean;
  testEnabled: boolean;
  // Checker commands by language
  lintCommands: Record<string, string>;
  testCommands: Record<string, string>;
  // File patterns for each language
  languagePatterns: Record<string, RegExp>;
  // Files to ignore
  ignorePatterns: RegExp[];
}

export interface CheckResult {
  success: boolean;
  checker: string;
  output: string;
  errors: string[];
  warnings: string[];
}

export interface HandlerContext {
  projectDir: string;
  config: CodeQualityConfig;
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
    file_path?: string;
    filePath?: string;
    command?: string;
    [key: string]: unknown;
  };
}

export interface OpenCodeHookInput {
  tool: string;
  args?: {
    filePath?: string;
    command?: string;
    [key: string]: unknown;
  };
}
