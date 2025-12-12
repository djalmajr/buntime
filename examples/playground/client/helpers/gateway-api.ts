const BASE_URL = "/_/plugin-gateway";

export interface CacheStats {
  entries: number;
  hits: number;
  misses: number;
  size: number;
}

export interface GatewayStats {
  cache: CacheStats | null;
  cors: { enabled: boolean } | null;
  rateLimit: { enabled: boolean } | null;
}

export interface InvalidateRequest {
  key?: string;
  pattern?: string;
}

export interface InvalidateResponse {
  invalidated: number | "all";
}

export const gatewayApi = {
  async getStats(): Promise<GatewayStats> {
    const res = await fetch(`${BASE_URL}/stats`);
    if (!res.ok) throw new Error(`Failed to fetch stats: ${res.statusText}`);
    return res.json();
  },

  async invalidateCache(request?: InvalidateRequest): Promise<InvalidateResponse> {
    const res = await fetch(`${BASE_URL}/cache/invalidate`, {
      body: JSON.stringify(request ?? {}),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!res.ok) throw new Error(`Failed to invalidate cache: ${res.statusText}`);
    return res.json();
  },
};
