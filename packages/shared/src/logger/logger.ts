import { ConsoleTransport } from "./transports/console";
import { FileTransport } from "./transports/file";
import {
  LOG_LEVEL_PRIORITY,
  type LogEntry,
  type Logger,
  type LoggerConfig,
  type LogLevel,
  type LogTransport,
} from "./types";

/**
 * Logger implementation with transport support
 */
class LoggerImpl implements Logger {
  private readonly context?: string;
  private readonly level: LogLevel;
  private readonly transports: LogTransport[];

  constructor(config: LoggerConfig, transports: LogTransport[], context?: string) {
    this.level = config.level ?? "info";
    this.transports = transports;
    this.context = context;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      context: this.context,
      level,
      message,
      meta,
      timestamp: new Date().toISOString(),
    };

    for (const transport of this.transports) {
      transport.write(entry);
    }
  }

  child(context: string): Logger {
    const fullContext = this.context ? `${this.context}:${context}` : context;
    return new LoggerImpl({ level: this.level }, this.transports, fullContext);
  }

  async close(): Promise<void> {
    await Promise.all(this.transports.map((t) => t.close?.()));
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log("debug", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log("error", message, meta);
  }

  async flush(): Promise<void> {
    await Promise.all(this.transports.map((t) => t.flush?.()));
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log("warn", message, meta);
  }
}

/**
 * Create a logger with transport support
 */
export function createLogger(config: LoggerConfig = {}): Logger {
  const transportConfigs = config.transports ?? ["console"];
  const transports: LogTransport[] = [];

  for (const t of transportConfigs) {
    if (typeof t === "string") {
      if (t === "console") {
        transports.push(
          new ConsoleTransport({
            colors: config.colors,
            format: config.format,
          }),
        );
      } else if (t === "file") {
        if (!config.filePath) {
          throw new Error("filePath is required when using file transport");
        }
        transports.push(new FileTransport({ path: config.filePath }));
      }
    } else {
      transports.push(t);
    }
  }

  return new LoggerImpl(config, transports);
}
