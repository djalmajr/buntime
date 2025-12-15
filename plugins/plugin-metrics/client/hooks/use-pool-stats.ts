import type { InferResponseType } from "hono";
import { useEffect, useState } from "react";
import { api } from "~/utils/api";

export type PoolStats = InferResponseType<(typeof api.stats)["$get"], 200>;

export function usePoolStats() {
  const [error, setError] = useState<Error | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<PoolStats | null>(null);

  useEffect(() => {
    const baseUrl = api.sse.$url().toString();
    const eventSource = new EventSource(baseUrl);

    eventSource.onopen = () => {
      setIsConnected(true);
      setIsLoading(false);
      setError(null);
    };

    eventSource.onmessage = (event) => {
      try {
        setStats(JSON.parse(event.data));
        setError(null);
      } catch (err) {
        console.error("[SSE] Failed to parse data:", err);
        setError(err instanceof Error ? err : new Error("Failed to parse stats"));
      }
    };

    eventSource.onerror = (err) => {
      console.error("[SSE] Connection error:", err);
      setIsConnected(false);

      if (eventSource.readyState === EventSource.CONNECTING) {
        setError(new Error("Reconnecting to server..."));
      } else if (eventSource.readyState === EventSource.CLOSED) {
        setError(new Error("Connection closed"));
        setIsLoading(false);
      }
    };

    return () => eventSource.close();
  }, []);

  return { error, isConnected, isLoading, stats };
}
