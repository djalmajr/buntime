export interface WorkerData {
  avgResponseTimeMs: number;
  errors: number;
  id: string;
  requests: number;
  status: "active" | "idle" | "ephemeral" | "offline";
  totalResponseTimeMs: number;
  uptime: number;
  // Ephemeral-only: session metrics
  lastRequestCount?: number;
  lastResponseTimeMs?: number;
}

export interface MetricsSSEData {
  pool: {
    activeWorkers: number;
    idleWorkers: number;
    pendingRequests: number;
    totalErrors: number;
    totalRequests: number;
    totalRetired: number;
    uptime: number;
  };
  workers: WorkerData[];
}

export function createMetricsSSE(onMessage: (data: MetricsSSEData) => void): EventSource {
  const basePath = (() => {
    const outlet = document.querySelector("fragment-outlet[data-fragment-base]");
    if (outlet) {
      const fragmentBase = outlet.getAttribute("data-fragment-base");
      if (fragmentBase) {
        return fragmentBase.replace(/\/$/, "");
      }
    }

    const base = document.querySelector("base");
    if (base) {
      const href = base.getAttribute("href") || "";
      return href.replace(/\/$/, "");
    }
    return "";
  })();

  const eventSource = new EventSource(`${basePath}/api/sse`);

  eventSource.onmessage = (event) => {
    try {
      const raw = JSON.parse(event.data);

      // Convert workers object to array
      type WorkerStatus = "active" | "idle" | "ephemeral" | "offline";
      interface RawWorker {
        age: number;
        avgResponseTimeMs: number;
        errorCount: number;
        idle: number;
        requestCount: number;
        status: WorkerStatus;
        totalResponseTimeMs: number;
        // Ephemeral-only
        lastRequestCount?: number;
        lastResponseTimeMs?: number;
      }
      const workersObj = raw.workers as Record<string, RawWorker>;
      const workersArray: WorkerData[] = Object.entries(workersObj).map(([id, worker]) => ({
        avgResponseTimeMs: worker.avgResponseTimeMs ?? 0,
        errors: worker.errorCount ?? 0,
        id,
        requests: worker.requestCount ?? 0,
        status: (worker.status ?? "active") as WorkerStatus,
        totalResponseTimeMs: worker.totalResponseTimeMs ?? 0,
        // For ephemeral workers, age is lastResponseTimeMs - keep as ms
        // For persistent workers, age is uptime in ms - convert to seconds
        uptime:
          worker.status === "ephemeral"
            ? Math.round(worker.age ?? 0)
            : Math.floor((worker.age ?? 0) / 1000),
        // Ephemeral-only session metrics
        lastRequestCount: worker.lastRequestCount,
        lastResponseTimeMs: worker.lastResponseTimeMs,
      }));

      // Map server fields to client expected fields
      const pool = raw.pool || {};
      const data: MetricsSSEData = {
        pool: {
          activeWorkers: pool.activeWorkers ?? 0,
          idleWorkers: 0, // Not tracked by server yet
          pendingRequests: 0, // Not tracked by server yet
          totalErrors: pool.totalWorkersFailed ?? 0,
          totalRequests: pool.totalRequests ?? 0,
          totalRetired: pool.totalWorkersRetired ?? 0,
          uptime: Math.floor((pool.uptimeMs ?? 0) / 1000), // Convert ms to seconds
        },
        workers: workersArray,
      };

      onMessage(data);
    } catch (error) {
      console.error("Failed to parse SSE data:", error);
    }
  };

  eventSource.onerror = (error) => {
    console.error("SSE connection error:", error);
  };

  return eventSource;
}
