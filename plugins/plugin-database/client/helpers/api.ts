// Database API client

/**
 * Get the base path for API calls.
 * When loaded via fragment-outlet, extracts plugin path from src attribute.
 * Falls back to base tag for standalone mode.
 */
function getApiBase(): string {
  const rootElement = document.getElementById("plugin-database-root");
  if (!rootElement) return "/database";

  // Fragment content is inside Shadow DOM, host is the fragment-outlet
  const rootNode = rootElement.getRootNode();
  if (rootNode instanceof ShadowRoot) {
    // Get the src attribute from fragment-outlet (this is where APIs are served)
    const outlet = rootNode.host;
    const src = outlet?.getAttribute("src");
    if (src) {
      // Extract the plugin path from src (e.g., "/database" from "/database/studio")
      const match = src.match(/^(\/[^/]+)/);
      return match?.[1] || "/database";
    }
  }

  // Fallback: read from base tag (standalone mode)
  const base = document.querySelector("base");
  if (base) {
    const href = base.getAttribute("href") || "";
    return href.replace(/\/$/, "") || "/database";
  }
  return "/database";
}

const API_BASE = `${getApiBase()}/api`;

export interface TableInfo {
  name: string;
  type: string;
}

export interface ColumnInfo {
  name: string;
  nullable: boolean;
  pk: boolean;
  type: string;
}

export interface AdapterInfo {
  adapters: string[];
  default: string;
}

export interface QueryResult {
  duration: number;
  rowCount: number;
  rows: Record<string, unknown>[];
}

export interface TableRowsResult {
  limit: number;
  offset: number;
  rows: Record<string, unknown>[];
  table: string;
  total: number;
}

export const api = {
  async getAdapters(): Promise<AdapterInfo> {
    const res = await fetch(`${API_BASE}/adapters`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async getTables(type?: string, tenant?: string): Promise<{ tables: TableInfo[]; type: string }> {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (tenant) params.set("tenant", tenant);
    const res = await fetch(`${API_BASE}/tables?${params}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async getTableSchema(
    tableName: string,
    type?: string,
    tenant?: string,
  ): Promise<{ columns: ColumnInfo[]; table: string; type: string }> {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (tenant) params.set("tenant", tenant);
    const res = await fetch(`${API_BASE}/tables/${tableName}/schema?${params}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async getTableRows(
    tableName: string,
    options?: { limit?: number; offset?: number; tenant?: string; type?: string },
  ): Promise<TableRowsResult> {
    const params = new URLSearchParams();
    if (options?.type) params.set("type", options.type);
    if (options?.tenant) params.set("tenant", options.tenant);
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.offset) params.set("offset", String(options.offset));
    const res = await fetch(`${API_BASE}/tables/${tableName}/rows?${params}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async executeQuery(sql: string, type?: string, tenant?: string): Promise<QueryResult> {
    const res = await fetch(`${API_BASE}/query`, {
      body: JSON.stringify({ sql, tenant, type }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async getHealth(type?: string): Promise<{ adapters?: Record<string, string>; status: string }> {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    const res = await fetch(`${API_BASE}/health?${params}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};
