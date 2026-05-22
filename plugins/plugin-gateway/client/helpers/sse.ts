import type {
  GatewaySSEData,
  RateLimitMetrics,
  RequestLogEntry,
  ShellExcludeEntry,
} from "../../server/types";

// Re-export types for client use
export type { GatewaySSEData, RateLimitMetrics, RequestLogEntry, ShellExcludeEntry };

/**
 * Get the base path for API calls from the base tag.
 */
export function getApiBase(): string {
  const base = document.querySelector("base");
  if (base) {
    const href = base.getAttribute("href") || "";
    return href.replace(/\/$/, "") || "/gateway";
  }
  return "/gateway";
}

/**
 * Create an EventSource for gateway SSE stream. The cpanel session cookie
 * (`buntime_api_key`, HttpOnly + SameSite=Strict) travels automatically on
 * same-origin EventSource connections — no header or query-string handling
 * required.
 */
export function createGatewaySSE(onMessage: (data: GatewaySSEData) => void): EventSource {
  const apiBase = getApiBase();
  const eventSource = new EventSource(`${apiBase}/admin/sse`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as GatewaySSEData;
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
