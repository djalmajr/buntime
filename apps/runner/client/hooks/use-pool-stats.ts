import type { InferResponseType } from "hono";
import { useEffect, useState } from "react";
import type { api } from "~/helpers/api-client";

export type PoolStats = InferResponseType<(typeof api.internal.stats)["$get"], 200>;

export function usePoolStats() {
  const [error, setError] = useState<Error | null>(null);
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const eventSource = new EventSource("/api/sse");

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

      // EventSource automatically reconnects, so we just update the UI
      if (eventSource.readyState === EventSource.CONNECTING) {
        setError(new Error("Reconnecting to server..."));
      } else if (eventSource.readyState === EventSource.CLOSED) {
        setError(new Error("Connection closed"));
        setIsLoading(false);
      }
    };

    return () => eventSource.close();
  }, []);

  return { stats, isLoading, error, isConnected };
}
