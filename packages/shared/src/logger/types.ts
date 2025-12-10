/**
 * Log levels in order of severity
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Priority map for log levels (higher = more severe)
 */
export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * A single log entry
 */
export interface LogEntry {
  context?: string;
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
  timestamp: string;
}

/**
 * Logger interface
 */
export interface Logger {
  /**
   * Create a child logger with additional context
   */
  child(context: string): Logger;
  /**
   * Close the logger and release resources
   */
  close(): Promise<void>;
  /**
   * Log a debug message
   */
  debug(message: string, meta?: Record<string, unknown>): void;
  /**
   * Log an error message
   */
  error(message: string, meta?: Record<string, unknown>): void;
  /**
   * Flush any buffered logs
   */
  flush(): Promise<void>;
  /**
   * Log an info message
   */
  info(message: string, meta?: Record<string, unknown>): void;
  /**
   * Log a warning message
   */
  warn(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Transport interface for log output
 */
export interface LogTransport {
  close?(): Promise<void>;
  flush?(): Promise<void>;
  write(entry: LogEntry): void;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /**
   * Enable colored output (default: auto-detect TTY)
   */
  colors?: boolean;
  /**
   * Path for file transport
   */
  filePath?: string;
  /**
   * Output format
   */
  format?: "json" | "pretty";
  /**
   * Minimum log level to output
   */
  level?: LogLevel;
  /**
   * Transports to use
   */
  transports?: ("console" | "file" | LogTransport)[];
}
