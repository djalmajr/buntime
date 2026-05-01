import { AppError } from "@buntime/shared/errors";
import type { WorkerConfig } from "@buntime/shared/utils/worker-config";
import QuickLRU from "quick-lru";
import { WorkerState } from "@/constants";
import { getEntrypoint } from "@/utils/get-entrypoint";
import { WorkerInstance } from "./instance";
import { type HistoricalStats, type PoolMetrics, WorkerMetrics, type WorkerStats } from "./metrics";
import { computeAvgResponseTime, roundTwoDecimals } from "./stats";

export interface PoolConfig {
  /** Max concurrent TTL=0 worker requests. Prevents cold-start churn from saturating the runtime. */
  ephemeralConcurrency?: number;
  /** Max queued TTL=0 requests before returning 503. */
  ephemeralQueueLimit?: number;
  maxSize: number;
}

const DEFAULT_EPHEMERAL_CONCURRENCY = 2;
const DEFAULT_EPHEMERAL_QUEUE_LIMIT = 100;

class AsyncGate {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(
    public readonly maxConcurrency: number,
    public readonly maxQueue: number,
  ) {}

  get pending(): number {
    return this.queue.length;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrency) {
      if (this.queue.length >= this.maxQueue) {
        throw new AppError(
          "Ephemeral worker queue is saturated",
          "EPHEMERAL_WORKER_QUEUE_SATURATED",
          503,
          {
            active: this.active,
            maxConcurrency: this.maxConcurrency,
            maxQueue: this.maxQueue,
            pending: this.queue.length,
          },
        );
      }
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }

    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function resolveEphemeralConcurrency(config: PoolConfig): number {
  const configured =
    config.ephemeralConcurrency ?? parsePositiveInt(Bun.env.RUNTIME_EPHEMERAL_CONCURRENCY);
  const fallback = Math.min(DEFAULT_EPHEMERAL_CONCURRENCY, config.maxSize);
  const value = configured ?? fallback;

  return Math.max(1, Math.min(config.maxSize, Math.floor(value)));
}

function resolveEphemeralQueueLimit(config: PoolConfig): number {
  const configured =
    config.ephemeralQueueLimit ?? parsePositiveInt(Bun.env.RUNTIME_EPHEMERAL_QUEUE_LIMIT);
  const value = configured ?? DEFAULT_EPHEMERAL_QUEUE_LIMIT;

  return Math.max(0, Math.floor(value));
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
  private ephemeralGate: AsyncGate;
  private metrics: WorkerMetrics;

  constructor(config: PoolConfig) {
    this.config = config;
    this.ephemeralGate = new AsyncGate(
      resolveEphemeralConcurrency(config),
      resolveEphemeralQueueLimit(config),
    );
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
    const run = () => this.fetchWorker(appDir, config, req, preReadBody);
    if (config.ttlMs === 0) {
      return this.ephemeralGate.run(run);
    }

    return run();
  }

  private async fetchWorker(
    appDir: string,
    config: WorkerConfig,
    req: Request,
    preReadBody?: ArrayBuffer | null,
  ): Promise<Response> {
    const startTime = performance.now();
    const { instance, key } = await this.getOrCreate(appDir, config);
    let response: Response;
    try {
      response = await instance.fetch(req, preReadBody);
    } catch (error) {
      if (config.ttlMs === 0) {
        this.metrics.recordWorkerFailed();
      }
      throw error;
    }
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
    return {
      ...this.metrics.getStats(this.cache.size),
      ephemeralConcurrency: this.ephemeralGate.maxConcurrency,
      ephemeralQueueDepth: this.ephemeralGate.pending,
      ephemeralQueueLimit: this.ephemeralGate.maxQueue,
    };
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
