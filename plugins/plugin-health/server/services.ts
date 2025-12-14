import type { PluginContext } from "@buntime/shared/types";

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface HealthCheck {
  details?: Record<string, unknown>;
  latency?: number;
  message?: string;
  name: string;
  status: HealthStatus;
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
 * Configure health service
 */
export function configure(options: { timeout?: number }) {
  if (options.timeout) timeout = options.timeout;
}

/**
 * Set logger instance
 */
export function setLogger(l: PluginContext["logger"]) {
  logger = l;
}

/**
 * Set pool reference
 */
export function setPool(p: { getMetrics(): Record<string, unknown> }) {
  pool = p;
}

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
export async function runHealthChecks(): Promise<HealthReport> {
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
      heapPercent,
      heapTotal: heapTotalMB,
      heapUsed: heapUsedMB,
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
    if (check.status === "degraded") {
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
export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
