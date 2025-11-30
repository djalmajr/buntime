export interface PoolMetrics {
  activeWorkers: number;
  avgResponseTimeMs: number;
  evictions: number;
  hitRate: number;
  hits: number;
  memoryUsageMB: number;
  misses: number;
  requestsPerSecond: number;
  totalRequests: number;
  totalWorkersFailed: number;
  totalWorkersCreated: number;
  uptimeMs: number;
}

export class WorkerMetrics {
  private evictions = 0;
  private hits = 0;
  private misses = 0;
  private requestCount = 0;
  private requestTimes: number[] = [];
  private startTime = Date.now();
  private totalWorkersFailed = 0;
  private totalWorkersCreated = 0;

  getStats(activeWorkers: number): PoolMetrics {
    const now = Date.now();
    const uptimeMs = now - this.startTime;
    const requestsPerSecond = this.requestCount / (uptimeMs / 1000);
    const avgResponseTimeMs =
      this.requestTimes.length > 0
        ? this.requestTimes.reduce((a, b) => a + b, 0) / this.requestTimes.length
        : 0;

    const totalCacheRequests = this.hits + this.misses;
    const hitRate = totalCacheRequests > 0 ? this.hits / totalCacheRequests : 0;

    return {
      activeWorkers,
      avgResponseTimeMs: Math.round(avgResponseTimeMs * 100) / 100,
      evictions: this.evictions,
      hitRate: Math.round(hitRate * 10000) / 100, // Percentage with 2 decimals
      hits: this.hits,
      memoryUsageMB: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100,
      misses: this.misses,
      requestsPerSecond: Math.round(requestsPerSecond * 100) / 100,
      totalRequests: this.requestCount,
      totalWorkersFailed: this.totalWorkersFailed,
      totalWorkersCreated: this.totalWorkersCreated,
      uptimeMs,
    };
  }

  recordEviction() {
    this.evictions++;
  }

  recordHit() {
    this.hits++;
  }

  recordMiss() {
    this.misses++;
  }

  recordRequest(durationMs: number) {
    this.requestCount++;
    this.requestTimes.push(durationMs);

    // Keep only last 100 requests for avg calculation
    if (this.requestTimes.length > 100) {
      this.requestTimes.shift();
    }
  }

  recordWorkerCreated() {
    this.totalWorkersCreated++;
  }

  recordWorkerFailed() {
    this.totalWorkersFailed++;
  }

  reset() {
    this.evictions = 0;
    this.hits = 0;
    this.misses = 0;
    this.requestCount = 0;
    this.requestTimes = [];
    this.startTime = Date.now();
    this.totalWorkersFailed = 0;
    this.totalWorkersCreated = 0;
  }
}
