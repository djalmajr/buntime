import { createLogger } from "./logger";
import type { Logger, LoggerConfig } from "./types";

// Logger factory
export { createLogger } from "./logger";

// Transports
export { ConsoleTransport, type ConsoleTransportOptions } from "./transports/console";
export { FileTransport, type FileTransportOptions } from "./transports/file";
export type { LogEntry, Logger, LoggerConfig, LogLevel, LogTransport } from "./types";
// Types
export { LOG_LEVEL_PRIORITY } from "./types";

/**
 * Global logger instance (singleton)
 */
let globalLogger: Logger | null = null;

/**
 * Get the global logger instance.
 * Creates a default logger if none has been set.
 */
export function getLogger(): Logger {
  return (globalLogger ||= createLogger());
}

/**
 * Set the global logger instance.
 * Use this to inject a custom logger (e.g., with file transport, Loki, etc.)
 */
export function setLogger(logger: Logger): void {
  globalLogger = logger;
}

/**
 * Get a child logger with the given context.
 * Useful for plugins and modules to have prefixed logs.
 *
 * @example
 * const logger = getChildLogger("plugin:keyval");
 * logger.info("Initialized"); // [plugin:keyval] Initialized
 */
export function getChildLogger(context: string): Logger {
  return getLogger().child(context);
}

/**
 * Initialize the global logger with the given configuration.
 * If already initialized, this will replace the existing logger.
 *
 * @example
 * initLogger({ level: "debug", format: "json" });
 */
export function initLogger(config: LoggerConfig = {}): Logger {
  globalLogger = createLogger(config);
  return globalLogger;
}
