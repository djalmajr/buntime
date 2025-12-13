// In dev, call buntime directly. In prod (served by buntime), use relative paths.
const API_BASE = import.meta.env.DEV ? "http://localhost:8000" : "";

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
  const eventSource = new EventSource(`${API_BASE}/api/metrics/sse`);

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
}
