export interface MetricsSSEData {
  pool: {
    activeWorkers: number;
    idleWorkers: number;
    pendingRequests: number;
    totalErrors: number;
    totalRequests: number;
    uptime: number;
  };
  workers: Array<{
    errors: number;
    id: string;
    requests: number;
    uptime: number;
  }>;
}

export function createMetricsSSE(onMessage: (data: MetricsSSEData) => void): EventSource {
  const basePath = (() => {
    const outlet = document.querySelector("piercing-fragment-outlet[data-fragment-base]");
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

      // Convert workers object to array (API returns Record<string, WorkerStat>)
      const workersObj = raw.workers as Record<string, Omit<MetricsSSEData["workers"][0], "id">>;
      const workersArray = Object.entries(workersObj).map(([id, worker]) => ({
        id,
        ...worker,
      }));

      const data: MetricsSSEData = {
        pool: raw.pool,
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
