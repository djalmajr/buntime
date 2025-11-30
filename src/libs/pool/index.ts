import QuickLRU from "quick-lru";
import { NODE_ENV, POOL_SIZE } from "@/constants";
import { getEntrypoint } from "@/utils/get-entrypoint";
import type { WorkerConfig } from "./config";
import { WorkerInstance } from "./instance";
import { type PoolMetrics, WorkerMetrics } from "./metrics";

interface PoolConfig {
  maxSize: number;
}

const defaults: Record<string, PoolConfig> = {
  development: { maxSize: 10 },
  production: { maxSize: 500 },
  staging: { maxSize: 50 },
  test: { maxSize: 5 },
};

function getPoolConfig(): PoolConfig {
  const config = defaults[NODE_ENV]!;
  if (POOL_SIZE) config.maxSize = POOL_SIZE;
  return config;
}

export class WorkerPool {
  private cache: QuickLRU<string, WorkerInstance>;
  private cleanupTimers = new Map<string, Timer>();
  private config: PoolConfig;
  private metrics: WorkerMetrics;

  constructor(config?: PoolConfig) {
    this.config = config || getPoolConfig();
    this.metrics = new WorkerMetrics();
    this.cache = new QuickLRU({
      maxSize: this.config.maxSize,
      onEviction: (key, instance) => {
        this.metrics.recordEviction();
        instance.terminate();
        this.cleanupTimer(key);
      },
    });
  }

  async getOrCreate(appDir: string, config: WorkerConfig): Promise<WorkerInstance> {
    const startTime = performance.now();
    const [, name, version] = appDir.match(/([^/]+)\/([^/]+)\/?$/) || [];
    const key = `${name}@${version}`;

    // Check cache for workers with TTL > 0
    if (config.ttlMs > 0) {
      const existing = this.cache.get(key);

      if (existing?.isHealthy()) {
        this.metrics.recordHit();
        existing.touch();

        const duration = performance.now() - startTime;
        this.metrics.recordRequest(duration);

        return existing;
      }

      // Unhealthy worker - remove it
      if (existing) {
        this.cache.delete(key);
        this.cleanupTimer(key);
      }
    }

    // Cache miss - create new worker
    this.metrics.recordMiss();
    this.metrics.recordWorkerCreated();

    try {
      const entry = await getEntrypoint(appDir, config.entrypoint);
      const instance = new WorkerInstance(appDir, entry.path, config);

      if (config.ttlMs > 0) {
        this.cache.set(key, instance);
        this.scheduleCleanup(key, instance, config);
      }

      const duration = performance.now() - startTime;
      this.metrics.recordRequest(duration);

      return instance;
    } catch (err) {
      this.metrics.recordWorkerFailed();
      throw err;
    }
  }

  getMetrics(): PoolMetrics {
    return this.metrics.getStats(this.cache.size);
  }

  getWorkerStats() {
    const stats: Record<string, ReturnType<WorkerInstance["getStats"]>> = {};
    for (const [key, worker] of this.cache) stats[key] = worker.getStats();
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

  private retire(key: string) {
    const worker = this.cache.get(key);
    if (worker) {
      worker.terminate();
      this.cache.delete(key);
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

export const pool = new WorkerPool();
