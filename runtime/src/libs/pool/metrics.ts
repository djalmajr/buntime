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
  totalWorkersRetired: number;
  uptimeMs: number;
}

export interface WorkerStats {
  age: number;
  avgResponseTimeMs: number;
  errorCount: number;
  idle: number;
  requestCount: number;
  status: "active" | "idle" | "ephemeral" | "offline";
  totalResponseTimeMs: number;
  // Ephemeral-only: session metrics (reset on page load/API)
  lastRequestCount?: number;
  lastResponseTimeMs?: number;
}

/** Cumulative stats across worker lifecycles (no status - just data) */
export interface HistoricalStats {
  avgResponseTimeMs: number;
  errorCount: number;
  requestCount: number;
  totalResponseTimeMs: number;
}

interface EphemeralWorker {
  avgResponseTimeMs: number;
  key: string;
  lastRequestAt: number;
  lastRequestCount: number;
  lastResponseTimeMs: number;
  totalRequestCount: number;
  totalResponseTimeMs: number;
}

const BUFFER_SIZE = 100;

export class WorkerMetrics {
  /** Ephemeral workers (TTL=0) with creation timestamps */
  private ephemeralWorkers: EphemeralWorker[] = [];
  private evictions = 0;
  private hits = 0;
  private misses = 0;
  private requestCount = 0;
  // Circular buffer for request times (avoids O(n) shift operations)
  private requestTimes = new Float64Array(BUFFER_SIZE);
  private requestTimesIndex = 0;
  private requestTimesCount = 0;
  /** Cumulative stats per worker key (persists across worker lifecycles) */
  private historicalStats = new Map<string, HistoricalStats>();
  private startTime = Date.now();
  private totalWorkersFailed = 0;
  private totalWorkersCreated = 0;
  private totalWorkersRetired = 0;

  getStats(activeWorkers: number): PoolMetrics {
    const now = Date.now();
    const uptimeMs = now - this.startTime;
    const requestsPerSecond = this.requestCount / (uptimeMs / 1000);

    let avgResponseTimeMs = 0;
    if (this.requestTimesCount > 0) {
      let sum = 0;
      for (let i = 0; i < this.requestTimesCount; i++) {
        sum += this.requestTimes[i]!;
      }
      avgResponseTimeMs = sum / this.requestTimesCount;
    }

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
      totalWorkersRetired: this.totalWorkersRetired,
      uptimeMs,
    };
  }

  getHistoricalStats(): Record<string, HistoricalStats> {
    return Object.fromEntries(this.historicalStats);
  }

  getEphemeralWorkers(): Record<string, WorkerStats> {
    const result: Record<string, WorkerStats> = {};
    for (const w of this.ephemeralWorkers) {
      result[w.key] = {
        age: Math.round(w.lastResponseTimeMs), // Last response time for list view
        avgResponseTimeMs: Math.round(w.avgResponseTimeMs * 100) / 100,
        errorCount: 0, // Not tracked per ephemeral worker
        idle: 0,
        requestCount: w.totalRequestCount, // Total requests since server start
        status: "ephemeral",
        totalResponseTimeMs: Math.round(w.totalResponseTimeMs * 100) / 100,
        // Session metrics
        lastRequestCount: w.lastRequestCount,
        lastResponseTimeMs: Math.round(w.lastResponseTimeMs * 100) / 100,
      };
    }
    return result;
  }

  recordEphemeralWorker(
    key: string,
    durationMs: number,
    isDocumentRequest: boolean,
    isApiRequest: boolean,
  ) {
    const now = Date.now();

    // Find existing entry for this key
    const existing = this.ephemeralWorkers.find((w) => w.key === key);

    if (existing) {
      // Reset if: document request (page load) OR API request (each is unique)
      const shouldReset = isDocumentRequest || isApiRequest;

      if (shouldReset) {
        // New session - reset last metrics, keep totals
        existing.lastRequestAt = now;
        existing.lastRequestCount = 1;
        existing.lastResponseTimeMs = durationMs;
        existing.totalRequestCount++;
        existing.totalResponseTimeMs += durationMs;
        existing.avgResponseTimeMs = existing.totalResponseTimeMs / existing.totalRequestCount;
      } else {
        // Same session (assets) - accumulate both
        existing.lastRequestAt = now;
        existing.lastRequestCount++;
        existing.lastResponseTimeMs += durationMs;
        existing.totalRequestCount++;
        existing.totalResponseTimeMs += durationMs;
        existing.avgResponseTimeMs = existing.totalResponseTimeMs / existing.totalRequestCount;
      }
    } else {
      this.ephemeralWorkers.push({
        avgResponseTimeMs: durationMs,
        key,
        lastRequestAt: now,
        lastRequestCount: 1,
        lastResponseTimeMs: durationMs,
        totalRequestCount: 1,
        totalResponseTimeMs: durationMs,
      });
    }
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
    // Circular buffer - O(1) instead of O(n) shift
    this.requestTimes[this.requestTimesIndex] = durationMs;
    this.requestTimesIndex = (this.requestTimesIndex + 1) % BUFFER_SIZE;
    if (this.requestTimesCount < BUFFER_SIZE) {
      this.requestTimesCount++;
    }
  }

  recordWorkerCreated() {
    this.totalWorkersCreated++;
  }

  recordWorkerFailed() {
    this.totalWorkersFailed++;
  }

  /** Accumulate stats when a worker is retired/terminated */
  accumulateWorkerStats(key: string, stats: HistoricalStats) {
    this.totalWorkersRetired++;

    const existing = this.historicalStats.get(key);
    if (existing) {
      const totalRequestCount = existing.requestCount + stats.requestCount;
      const totalResponseTimeMs = existing.totalResponseTimeMs + stats.totalResponseTimeMs;
      const avgResponseTimeMs = totalRequestCount > 0 ? totalResponseTimeMs / totalRequestCount : 0;

      this.historicalStats.set(key, {
        avgResponseTimeMs: Math.round(avgResponseTimeMs * 100) / 100,
        errorCount: existing.errorCount + stats.errorCount,
        requestCount: totalRequestCount,
        totalResponseTimeMs: Math.round(totalResponseTimeMs * 100) / 100,
      });
    } else {
      this.historicalStats.set(key, stats);
    }
  }

  reset() {
    this.ephemeralWorkers = [];
    this.evictions = 0;
    this.historicalStats.clear();
    this.hits = 0;
    this.misses = 0;
    this.requestCount = 0;
    this.requestTimes.fill(0);
    this.requestTimesIndex = 0;
    this.requestTimesCount = 0;
    this.startTime = Date.now();
    this.totalWorkersFailed = 0;
    this.totalWorkersCreated = 0;
    this.totalWorkersRetired = 0;
  }
}
