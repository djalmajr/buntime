import type { PluginContext } from "@buntime/shared/types";

export type LogLevel = "debug" | "error" | "info" | "warn";

export interface LogEntry {
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
  source: string;
  timestamp: Date;
}

// In-memory log buffer (ring buffer)
let logs: LogEntry[] = [];
let maxEntries = 1000;
let sseInterval = 1000;
let logger: PluginContext["logger"] | undefined;
const subscribers: Set<() => void> = new Set();

/**
 * Configure log service
 */
export function configure(options: { maxEntries?: number; sseInterval?: number }) {
  if (options.maxEntries) maxEntries = options.maxEntries;
  if (options.sseInterval) sseInterval = options.sseInterval;
}

/**
 * Set logger instance
 */
export function setLogger(l: PluginContext["logger"]) {
  logger = l;
}

/**
 * Get SSE interval
 */
export function getSseInterval() {
  return sseInterval;
}

/**
 * Get subscribers set
 */
export function getSubscribers() {
  return subscribers;
}

/**
 * Add a log entry to the buffer
 */
export function addLog(entry: Omit<LogEntry, "timestamp">): void {
  const logEntry: LogEntry = {
    ...entry,
    timestamp: new Date(),
  };

  logs.push(logEntry);

  // Trim to max entries
  if (logs.length > maxEntries) {
    logs = logs.slice(-maxEntries);
  }

  // Notify subscribers
  for (const notify of subscribers) {
    notify();
  }
}

/**
 * Get recent logs, optionally filtered
 */
export function getLogs(options?: {
  level?: LogLevel;
  limit?: number;
  search?: string;
  source?: string;
}): LogEntry[] {
  let filtered = [...logs];

  if (options?.level) {
    filtered = filtered.filter((l) => l.level === options.level);
  }

  if (options?.source) {
    const source = options.source;
    filtered = filtered.filter((l) => l.source.includes(source));
  }

  if (options?.search) {
    const term = options.search.toLowerCase();
    filtered = filtered.filter(
      (l) => l.message.toLowerCase().includes(term) || l.source.toLowerCase().includes(term),
    );
  }

  if (options?.limit) {
    filtered = filtered.slice(-options.limit);
  }

  return filtered.reverse(); // Most recent first
}

/**
 * Get all logs (for SSE)
 */
export function getAllLogs() {
  return logs;
}

/**
 * Clear all logs
 */
export function clearLogs(): void {
  logs = [];
}

/**
 * Get log statistics
 */
export function getStats() {
  const counts = { debug: 0, error: 0, info: 0, warn: 0 };
  for (const log of logs) {
    counts[log.level]++;
  }
  return {
    counts,
    newest: logs[logs.length - 1]?.timestamp,
    oldest: logs[0]?.timestamp,
    total: logs.length,
  };
}
