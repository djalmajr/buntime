import type { BasePluginConfig, BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { Hono } from "hono";

export interface HealthConfig extends BasePluginConfig {
  /**
   * Health check timeout in milliseconds
   * @default 5000
   */
  timeout?: number;
}

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface HealthCheck {
  name: string;
  status: HealthStatus;
  message?: string;
  latency?: number;
  details?: Record<string, unknown>;
}

export interface HealthReport {
  checks: HealthCheck[];
  status: HealthStatus;
  timestamp: Date;
  uptime: number;
}

// Plugin state
let pool: { getMetrics(): Record<string, unknown> } | undefined;
let logger: PluginContext["logger"] | undefined;
let timeout = 5000;
const startTime = Date.now();

// Custom health checks registered by other plugins
const customChecks: Map<string, () => Promise<HealthCheck> | HealthCheck> = new Map();

/**
 * Register a custom health check
 */
export function registerHealthCheck(
  name: string,
  check: () => Promise<HealthCheck> | HealthCheck,
): void {
  customChecks.set(name, check);
}

/**
 * Unregister a health check
 */
export function unregisterHealthCheck(name: string): void {
  customChecks.delete(name);
}

/**
 * Run all health checks
 */
async function runHealthChecks(): Promise<HealthReport> {
  const checks: HealthCheck[] = [];
  let overallStatus: HealthStatus = "healthy";

  // Check pool health
  if (pool) {
    const start = performance.now();
    try {
      const metrics = pool.getMetrics();
      const latency = performance.now() - start;

      const activeWorkers = metrics.activeWorkers as number;
      const totalFailed = metrics.totalWorkersFailed as number;

      let status: HealthStatus = "healthy";
      let message = `${activeWorkers} active workers`;

      if (totalFailed > 10) {
        status = "degraded";
        message = `${totalFailed} workers failed`;
      }

      checks.push({
        details: { activeWorkers, totalFailed },
        latency,
        message,
        name: "pool",
        status,
      });
    } catch (err) {
      checks.push({
        latency: performance.now() - start,
        message: err instanceof Error ? err.message : "Unknown error",
        name: "pool",
        status: "unhealthy",
      });
    }
  }

  // Check memory
  const memUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
  const heapPercent = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);

  let memStatus: HealthStatus = "healthy";
  if (heapPercent > 90) {
    memStatus = "unhealthy";
  } else if (heapPercent > 75) {
    memStatus = "degraded";
  }

  checks.push({
    details: {
      external: Math.round(memUsage.external / 1024 / 1024),
      heapTotal: heapTotalMB,
      heapUsed: heapUsedMB,
      heapPercent,
      rss: Math.round(memUsage.rss / 1024 / 1024),
    },
    message: `${heapUsedMB}MB / ${heapTotalMB}MB (${heapPercent}%)`,
    name: "memory",
    status: memStatus,
  });

  // Run custom checks with timeout
  for (const [name, check] of customChecks) {
    const start = performance.now();
    try {
      const result = await Promise.race([
        Promise.resolve(check()),
        new Promise<HealthCheck>((_, reject) =>
          setTimeout(() => reject(new Error("Health check timeout")), timeout),
        ),
      ]);
      checks.push({
        ...result,
        latency: performance.now() - start,
      });
    } catch (err) {
      checks.push({
        latency: performance.now() - start,
        message: err instanceof Error ? err.message : "Unknown error",
        name,
        status: "unhealthy",
      });
    }
  }

  // Calculate overall status
  for (const check of checks) {
    if (check.status === "unhealthy") {
      overallStatus = "unhealthy";
      break;
    }
    if (check.status === "degraded" && overallStatus !== "unhealthy") {
      overallStatus = "degraded";
    }
  }

  return {
    checks,
    status: overallStatus,
    timestamp: new Date(),
    uptime: Date.now() - startTime,
  };
}

/**
 * Format uptime as human-readable string
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Render the health fragment HTML
 */
async function renderFragment(): Promise<string> {
  const report = await runHealthChecks();

  const statusColors: Record<HealthStatus, { bg: string; text: string; icon: string }> = {
    degraded: { bg: "bg-yellow-100", icon: "!", text: "text-yellow-700" },
    healthy: { bg: "bg-green-100", icon: "\u2713", text: "text-green-700" },
    unhealthy: { bg: "bg-red-100", icon: "\u2717", text: "text-red-700" },
  };

  const overall = statusColors[report.status];

  const checkRows = report.checks
    .map((check) => {
      const colors = statusColors[check.status];
      const latencyStr = check.latency !== undefined ? `${check.latency.toFixed(1)}ms` : "-";

      return `
        <tr class="border-b hover:bg-gray-50">
          <td class="px-4 py-3">
            <span class="font-medium">${check.name}</span>
          </td>
          <td class="px-4 py-3">
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${colors.bg} ${colors.text}">
              <span>${colors.icon}</span>
              ${check.status}
            </span>
          </td>
          <td class="px-4 py-3 text-sm text-gray-600">${check.message || "-"}</td>
          <td class="px-4 py-3 text-sm text-gray-500 font-mono">${latencyStr}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="p-6">
      <div class="mb-6">
        <div class="flex items-center gap-3 mb-2">
          <h1 class="text-2xl font-bold">System Health</h1>
          <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${overall.bg} ${overall.text}">
            <span>${overall.icon}</span>
            ${report.status.charAt(0).toUpperCase() + report.status.slice(1)}
          </span>
        </div>
        <p class="text-sm text-gray-500">
          Uptime: ${formatUptime(report.uptime)} | Last checked: ${report.timestamp.toLocaleTimeString()}
        </p>
      </div>

      <div class="bg-white rounded-lg border shadow-sm">
        <table class="w-full">
          <thead class="bg-gray-50 border-b">
            <tr>
              <th class="px-4 py-3 text-left text-sm font-medium text-gray-500">Component</th>
              <th class="px-4 py-3 text-left text-sm font-medium text-gray-500">Status</th>
              <th class="px-4 py-3 text-left text-sm font-medium text-gray-500">Message</th>
              <th class="px-4 py-3 text-left text-sm font-medium text-gray-500">Latency</th>
            </tr>
          </thead>
          <tbody>
            ${checkRows}
          </tbody>
        </table>
      </div>

      <p class="mt-4 text-sm text-gray-500">
        Fragment rendered by @buntime/plugin-health
      </p>
    </div>
  `;
}

// API routes
const routes = new Hono()
  .get("/", async (ctx) => {
    const report = await runHealthChecks();
    return ctx.json(report);
  })
  .get("/live", (ctx) => {
    // Liveness probe - always returns 200 if server is running
    return ctx.json({ status: "live" });
  })
  .get("/ready", async (ctx) => {
    // Readiness probe - returns 200 only if all checks pass
    const report = await runHealthChecks();
    const status = report.status === "healthy" ? 200 : 503;
    return ctx.json(report, status);
  });

export type HealthRoutesType = typeof routes;

/**
 * Health plugin for Buntime
 *
 * Provides:
 * - System health checks (pool, memory)
 * - Custom health check registration
 * - Fragment UI for viewing health status
 * - Kubernetes-compatible probes (/live, /ready)
 */
export default function healthPlugin(pluginConfig: HealthConfig = {}): BuntimePlugin {
  timeout = pluginConfig.timeout ?? 5000;

  return {
    name: "@buntime/plugin-health",
    base: pluginConfig.base ?? "/api/plugin-health",
    version: "1.0.0",
    routes,

    // Fragment configuration for micro-frontend
    fragment: {
      fragmentId: "health",
      prePierceRoutes: ["/cpanel/health", "/cpanel/health/*"],
      fetchFragment: async () => {
        const html = await renderFragment();
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
    },

    onInit(ctx: PluginContext) {
      logger = ctx.logger;
      pool = ctx.pool as { getMetrics(): Record<string, unknown> };
      ctx.logger.info("Health plugin initialized");

      // Register health service for other plugins
      ctx.registerService("health", {
        registerHealthCheck,
        runHealthChecks,
        unregisterHealthCheck,
      });
    },
  };
}
