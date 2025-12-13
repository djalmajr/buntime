const BASE_URL = "/api/metrics";

export interface PoolMetrics {
  activeWorkers: number;
  idleWorkers: number;
  pendingRequests: number;
  totalRequests: number;
  totalErrors: number;
  uptime: number;
}

export interface WorkerStats {
  errors: number;
  id: string;
  requests: number;
  uptime: number;
}

export interface StatsResponse {
  pool: PoolMetrics;
  workers: WorkerStats[];
}

export const metricsApi = {
  async getMetrics(): Promise<Record<string, number>> {
    const res = await fetch(`${BASE_URL}/`);
    if (!res.ok) throw new Error(`Failed to fetch metrics: ${res.statusText}`);
    return res.json();
  },

  async getStats(): Promise<StatsResponse> {
    const res = await fetch(`${BASE_URL}/stats`);
    if (!res.ok) throw new Error(`Failed to fetch stats: ${res.statusText}`);
    return res.json();
  },

  async getPrometheus(): Promise<string> {
    const res = await fetch(`${BASE_URL}/prometheus`);
    if (!res.ok) throw new Error(`Failed to fetch prometheus: ${res.statusText}`);
    return res.text();
  },

  createSSEConnection(onMessage: (data: StatsResponse) => void): EventSource {
    const eventSource = new EventSource(`${BASE_URL}/sse`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (error) {
        console.error("Failed to parse SSE data:", error);
      }
    };

    eventSource.onerror = (error) => {
      console.error("SSE connection error:", error);
    };

    return eventSource;
  },
};
