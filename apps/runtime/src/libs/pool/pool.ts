import QuickLRU from "quick-lru";
import { WorkerState } from "@/constants";
import { getEntrypoint } from "@/utils/get-entrypoint";
import type { WorkerConfig } from "./config";
import { WorkerInstance } from "./instance";
import { type HistoricalStats, type PoolMetrics, WorkerMetrics, type WorkerStats } from "./metrics";
import { computeAvgResponseTime, roundTwoDecimals } from "./stats";

export interface PoolConfig {
  maxSize: number;
}

/**
 * Parse app directory path to extract name and version for cache key
 *
 * Supports two folder structures:
 * - Flat: /workerDirs/app-name@1.0.0 → name: "app-name", version: "1.0.0"
 * - Nested: /workerDirs/app-name/1.0.0 → name: "app-name", version: "1.0.0"
 *
 * Falls back to package.json version if available.
 */
async function parseAppKey(appDir: string): Promise<string> {
  const [, parent = "", folder = ""] = appDir.match(/([^/]+)\/([^/]+)\/?$/) || [];

  // Determine structure: nested (folder is semver) or flat (folder has @version)
  const isNestedStructure = /^\d+\.\d+\.\d+/.test(folder);
  const name = isNestedStructure ? parent : (folder.split("@")[0] ?? folder);
  let version = isNestedStructure ? folder : (folder.split("@")[1] ?? "latest");

  // Try to get version from package.json (overrides folder version)
  try {
    const pkg = await Bun.file(`${appDir}/package.json`).json();
    if (pkg.version) version = pkg.version;
  } catch {
    // No package.json, use folder version
  }

  return `${name}@${version}`;
}

/**
 * Merge current worker stats with historical stats
 * Combines request counts, response times, and errors
 */
function mergeWithHistorical(current: WorkerStats, hist: HistoricalStats): WorkerStats {
  const totalRequestCount = hist.requestCount + current.requestCount;
  const totalResponseTimeMs = hist.totalResponseTimeMs + current.totalResponseTimeMs;

  return {
    ...current,
    avgResponseTimeMs: computeAvgResponseTime(totalResponseTimeMs, totalRequestCount),
    errorCount: hist.errorCount + current.errorCount,
    requestCount: totalRequestCount,
    totalResponseTimeMs: roundTwoDecimals(totalResponseTimeMs),
  };
}

export class WorkerPool {
  private workerDirs = new Map<string, string>(); // key → appDir (collision detection)
  private cache: QuickLRU<string, WorkerInstance>;
  private cleanupTimers = new Map<string, Timer>();
  private config: PoolConfig;
  private metrics: WorkerMetrics;

  constructor(config: PoolConfig) {
    this.config = config;
    this.metrics = new WorkerMetrics();
    this.cache = new QuickLRU({
      maxSize: this.config.maxSize,
      onEviction: (key, instance) => {
        this.metrics.recordEviction();
        this.metrics.accumulateWorkerStats(key, this.extractHistoricalStats(instance));
        instance.terminate();
        this.cleanupTimer(key);
        this.workerDirs.delete(key);
      },
    });
  }

  private async getOrCreate(
    appDir: string,
    config: WorkerConfig,
  ): Promise<{ instance: WorkerInstance; key: string }> {
    const startTime = performance.now();
    const key = await parseAppKey(appDir);

    // Check for collision: same key from different appDir
    const existingAppDir = this.workerDirs.get(key);
    if (existingAppDir && existingAppDir !== appDir) {
      throw new Error(
        `Worker collision: "${key}" already registered from "${existingAppDir}", cannot register from "${appDir}"`,
      );
    }

    // Check cache for workers with TTL > 0
    if (config.ttlMs > 0) {
      const existing = this.cache.get(key);

      if (existing?.isHealthy()) {
        this.metrics.recordHit();
        existing.touch();

        const duration = performance.now() - startTime;
        this.metrics.recordRequest(duration);

        return { instance: existing, key };
      }

      // Unhealthy worker - remove it
      if (existing) {
        this.cache.delete(key);
        this.cleanupTimer(key);
        this.workerDirs.delete(key);
      }
    }

    // Cache miss - create new worker
    this.metrics.recordMiss();
    this.metrics.recordWorkerCreated();

    try {
      const entry = await getEntrypoint(appDir, config.entrypoint);
      const instance = new WorkerInstance(appDir, entry.path, config);

      const duration = performance.now() - startTime;
      this.metrics.recordRequest(duration);

      if (config.ttlMs > 0) {
        this.cache.set(key, instance);
        this.workerDirs.set(key, appDir);
        this.scheduleCleanup(key, instance, config);
      }

      return { instance, key };
    } catch (err) {
      this.metrics.recordWorkerFailed();
      throw err;
    }
  }

  /**
   * Fetch a request through a worker (creates worker if needed)
   * Measures total duration including request processing
   * @param appDir - Application directory
   * @param config - Worker configuration
   * @param req - Request object
   * @param preReadBody - Optional pre-read body to avoid double-reading in the pipeline
   */
  async fetch(
    appDir: string,
    config: WorkerConfig,
    req: Request,
    preReadBody?: ArrayBuffer | null,
  ): Promise<Response> {
    const startTime = performance.now();
    const { instance, key } = await this.getOrCreate(appDir, config);
    const response = await instance.fetch(req, preReadBody);
    const duration = performance.now() - startTime;

    // Record response time for persistent workers
    if (config.ttlMs > 0) {
      instance.recordResponseTime(duration);
    } else {
      // Record ephemeral worker with full request duration
      // Detect request type via Sec-Fetch-Dest header
      const fetchDest = req.headers.get("Sec-Fetch-Dest");
      const isDocumentRequest = fetchDest === "document";
      const isApiRequest = fetchDest === "empty" || !fetchDest; // fetch/XHR or missing header
      this.metrics.recordEphemeralWorker(key, duration, isDocumentRequest, isApiRequest);
    }

    return response;
  }

  getMetrics(): PoolMetrics {
    return this.metrics.getStats(this.cache.size);
  }

  getWorkerStats(): Record<string, WorkerStats> {
    const stats: Record<string, WorkerStats> = {};
    const historical = this.metrics.getHistoricalStats();

    // 1. Historical-only workers: show with "offline" status
    // These are workers that were retired and not recreated yet
    for (const [key, hist] of Object.entries(historical)) {
      stats[key] = {
        ageMs: 0,
        avgResponseTimeMs: hist.avgResponseTimeMs,
        errorCount: hist.errorCount,
        idleMs: 0,
        requestCount: hist.requestCount,
        status: WorkerState.OFFLINE,
        totalResponseTimeMs: hist.totalResponseTimeMs,
      };
    }

    // 2. Ephemeral workers: merge with historical data (overwrites offline)
    const ephemeral = this.metrics.getEphemeralWorkers();
    for (const [key, workerStats] of Object.entries(ephemeral)) {
      const hist = historical[key];
      stats[key] = hist ? mergeWithHistorical(workerStats, hist) : workerStats;
    }

    // 3. Active workers: merge with historical data (overwrites offline/ephemeral)
    for (const [key, worker] of this.cache) {
      const current = worker.getStats();
      const hist = historical[key];
      stats[key] = hist ? mergeWithHistorical(current, hist) : current;
    }

    return stats;
  }

  shutdown() {
    for (const [key] of this.cache) {
      this.retire(key);
    }
  }

  private cleanupTimer(key: string) {
    const timer = this.cleanupTimers.get(key);
    if (timer) {
      clearInterval(timer);
      this.cleanupTimers.delete(key);
    }
  }

  private extractHistoricalStats(worker: WorkerInstance): HistoricalStats {
    const stats = worker.getStats();
    return {
      avgResponseTimeMs: stats.avgResponseTimeMs,
      errorCount: stats.errorCount,
      requestCount: stats.requestCount,
      totalResponseTimeMs: stats.totalResponseTimeMs,
    };
  }

  private retire(key: string) {
    const worker = this.cache.get(key);
    if (worker) {
      this.metrics.accumulateWorkerStats(key, this.extractHistoricalStats(worker));
      worker.terminate();
      this.cache.delete(key);
      this.workerDirs.delete(key);
    }
    this.cleanupTimer(key);
  }

  private scheduleCleanup(key: string, instance: WorkerInstance, config: WorkerConfig) {
    this.cleanupTimer(key);
    const timer = setInterval(() => {
      if (!instance.isHealthy()) this.retire(key);
    }, Math.min(config.idleTimeoutMs, config.ttlMs) / 2);
    this.cleanupTimers.set(key, timer);
  }
}
