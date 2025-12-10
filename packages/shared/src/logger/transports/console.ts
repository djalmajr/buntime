import { LOG_LEVEL_PRIORITY, type LogEntry, type LogLevel, type LogTransport } from "../types";

/**
 * ANSI color codes for terminal output
 */
const COLORS = {
  debug: "\x1b[36m", // cyan
  dim: "\x1b[2m",
  error: "\x1b[31m", // red
  info: "\x1b[32m", // green
  reset: "\x1b[0m",
  warn: "\x1b[33m", // yellow
} as const;

/**
 * Level labels with fixed width for alignment
 */
const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: "DBG",
  error: "ERR",
  info: "INF",
  warn: "WRN",
};

/**
 * Console transport options
 */
export interface ConsoleTransportOptions {
  /**
   * Use colors in output
   * @default true (if TTY)
   */
  colors?: boolean;
  /**
   * Output format
   * @default "pretty"
   */
  format?: "json" | "pretty";
}

/**
 * Console transport for logging
 */
export class ConsoleTransport implements LogTransport {
  private readonly colors: boolean;
  private readonly format: "json" | "pretty";

  constructor(options: ConsoleTransportOptions = {}) {
    this.format = options.format ?? "pretty";
    this.colors = options.colors ?? process.stdout.isTTY ?? false;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }

  write(entry: LogEntry): void {
    if (this.format === "json") {
      this.writeJson(entry);
    } else {
      this.writePretty(entry);
    }
  }

  private writeJson(entry: LogEntry): void {
    const output = JSON.stringify({
      level: entry.level,
      message: entry.message,
      time: entry.timestamp,
      ...(entry.context && { context: entry.context }),
      ...(entry.meta && Object.keys(entry.meta).length > 0 && entry.meta),
    });

    if (LOG_LEVEL_PRIORITY[entry.level] >= LOG_LEVEL_PRIORITY.error) {
      console.error(output);
    } else {
      console.log(output);
    }
  }

  private writePretty(entry: LogEntry): void {
    const color = this.colors ? COLORS[entry.level] : "";
    const reset = this.colors ? COLORS.reset : "";
    const dim = this.colors ? COLORS.dim : "";

    const label = LEVEL_LABELS[entry.level];
    const time = entry.timestamp.split("T")[1]?.replace("Z", "") ?? entry.timestamp;

    let line = `${dim}${time}${reset} ${color}${label}${reset}`;

    if (entry.context) {
      line += ` ${dim}[${entry.context}]${reset}`;
    }

    line += ` ${entry.message}`;

    if (entry.meta && Object.keys(entry.meta).length > 0) {
      const metaStr = JSON.stringify(entry.meta);
      if (metaStr.length < 80) {
        line += ` ${dim}${metaStr}${reset}`;
      } else {
        line += `\n${dim}${JSON.stringify(entry.meta, null, 2)}${reset}`;
      }
    }

    if (LOG_LEVEL_PRIORITY[entry.level] >= LOG_LEVEL_PRIORITY.error) {
      console.error(line);
    } else {
      console.log(line);
    }
  }
}
