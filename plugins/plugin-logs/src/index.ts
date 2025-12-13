import type { BasePluginConfig, BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

export interface LogsConfig extends BasePluginConfig {
  /**
   * Maximum number of log entries to keep in memory
   * @default 1000
   */
  maxEntries?: number;

  /**
   * SSE update interval in milliseconds
   * @default 1000
   */
  sseInterval?: number;
}

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
function getLogs(options?: {
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
 * Clear all logs
 */
function clearLogs(): void {
  logs = [];
}

/**
 * Get log statistics
 */
function getStats() {
  const counts = { debug: 0, error: 0, info: 0, warn: 0 };
  for (const log of logs) {
    counts[log.level]++;
  }
  return {
    counts,
    oldest: logs[0]?.timestamp,
    newest: logs[logs.length - 1]?.timestamp,
    total: logs.length,
  };
}

/**
 * Render the logs fragment HTML
 */
function renderFragment(req: Request): string {
  const url = new URL(req.url);
  const level = url.searchParams.get("level") as LogLevel | null;
  const search = url.searchParams.get("search") || "";
  const limit = Number.parseInt(url.searchParams.get("limit") || "100", 10);

  const entries = getLogs({ level: level || undefined, limit, search });
  const stats = getStats();

  const levelColors: Record<LogLevel, string> = {
    debug: "bg-gray-100 text-gray-700",
    error: "bg-red-100 text-red-700",
    info: "bg-blue-100 text-blue-700",
    warn: "bg-yellow-100 text-yellow-700",
  };

  const logRows = entries
    .map((entry) => {
      const time = entry.timestamp.toLocaleTimeString();
      const levelClass = levelColors[entry.level];
      const meta = entry.meta ? JSON.stringify(entry.meta) : "";

      return `
        <tr class="border-b hover:bg-gray-50">
          <td class="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">${time}</td>
          <td class="px-3 py-2">
            <span class="px-2 py-0.5 rounded text-xs font-medium ${levelClass}">${entry.level}</span>
          </td>
          <td class="px-3 py-2 text-sm text-gray-600 font-mono">${entry.source}</td>
          <td class="px-3 py-2 text-sm">${escapeHtml(entry.message)}</td>
          <td class="px-3 py-2 text-xs text-gray-400 font-mono">${meta ? escapeHtml(meta) : "-"}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="p-6">
      <div class="mb-4 flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold mb-2">Logs</h1>
          <p class="text-sm text-gray-500">
            Total: ${stats.total} entries
            (${stats.counts.error} errors, ${stats.counts.warn} warnings)
          </p>
        </div>
        <div class="flex gap-2">
          <a href="/cpanel/logs" class="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded">All</a>
          <a href="/cpanel/logs?level=error" class="px-3 py-1.5 text-sm bg-red-100 hover:bg-red-200 text-red-700 rounded">Errors</a>
          <a href="/cpanel/logs?level=warn" class="px-3 py-1.5 text-sm bg-yellow-100 hover:bg-yellow-200 text-yellow-700 rounded">Warnings</a>
          <a href="/cpanel/logs?level=info" class="px-3 py-1.5 text-sm bg-blue-100 hover:bg-blue-200 text-blue-700 rounded">Info</a>
        </div>
      </div>

      <div class="bg-white rounded-lg border shadow-sm overflow-hidden">
        <table class="w-full text-left">
          <thead class="bg-gray-50 border-b">
            <tr>
              <th class="px-3 py-2 text-xs font-medium text-gray-500">Time</th>
              <th class="px-3 py-2 text-xs font-medium text-gray-500">Level</th>
              <th class="px-3 py-2 text-xs font-medium text-gray-500">Source</th>
              <th class="px-3 py-2 text-xs font-medium text-gray-500">Message</th>
              <th class="px-3 py-2 text-xs font-medium text-gray-500">Meta</th>
            </tr>
          </thead>
          <tbody>
            ${logRows || '<tr><td colspan="5" class="px-3 py-8 text-center text-gray-500">No logs yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// API routes
const routes = new Hono()
  .get("/", (ctx) => {
    const level = ctx.req.query("level") as LogLevel | undefined;
    const search = ctx.req.query("search");
    const limit = Number.parseInt(ctx.req.query("limit") || "100", 10);

    return ctx.json({
      logs: getLogs({ level, limit, search }),
      stats: getStats(),
    });
  })
  .get("/stats", (ctx) => {
    return ctx.json(getStats());
  })
  .get("/sse", (ctx) => {
    return streamSSE(ctx, async (stream) => {
      let lastLength = logs.length;

      const notify = () => {
        // Will be checked in the loop
      };

      subscribers.add(notify);

      try {
        while (true) {
          if (logs.length !== lastLength) {
            const newLogs = logs.slice(lastLength);
            lastLength = logs.length;
            await stream.writeSSE({
              data: JSON.stringify({ logs: newLogs, stats: getStats() }),
            });
          }
          await stream.sleep(sseInterval);
        }
      } finally {
        subscribers.delete(notify);
      }
    });
  })
  .post("/clear", (ctx) => {
    clearLogs();
    return ctx.json({ success: true });
  })
  .post("/add", async (ctx) => {
    const body = await ctx.req.json<Omit<LogEntry, "timestamp">>();
    addLog(body);
    return ctx.json({ success: true });
  });

export type LogsRoutesType = typeof routes;

/**
 * Logs plugin for Buntime
 *
 * Provides:
 * - In-memory log collection
 * - Fragment UI for viewing logs
 * - API endpoints for fetching and managing logs
 * - SSE for real-time log streaming
 */
export default function logsPlugin(pluginConfig: LogsConfig = {}): BuntimePlugin {
  maxEntries = pluginConfig.maxEntries ?? 1000;
  sseInterval = pluginConfig.sseInterval ?? 1000;

  return {
    name: "@buntime/plugin-logs",
    base: pluginConfig.base ?? "/api/plugin-logs",
    version: "1.0.0",
    routes,

    // Fragment configuration for micro-frontend
    fragment: {
      fragmentId: "logs",
      prePierceRoutes: ["/cpanel/logs", "/cpanel/logs/*"],
      fetchFragment: async (req: Request) => {
        const html = renderFragment(req);
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
    },

    onInit(ctx: PluginContext) {
      logger = ctx.logger;
      ctx.logger.info("Logs plugin initialized");

      // Register log service for other plugins to use
      ctx.registerService("logs", { addLog, clearLogs, getLogs, getStats });
    },
  };
}
