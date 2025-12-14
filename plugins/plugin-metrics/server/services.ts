export interface PoolLike {
  getMetrics(): Record<string, unknown>;
  getWorkerStats(): Record<string, unknown>[];
}

let pool: PoolLike | undefined;

export function setPool(p: PoolLike) {
  pool = p;
}

export function getStats() {
  if (!pool) {
    return { pool: {}, workers: [] };
  }

  return {
    pool: pool.getMetrics(),
    workers: pool.getWorkerStats(),
  };
}

export function getMetrics(): Record<string, unknown> | null {
  if (!pool) {
    return null;
  }
  return pool.getMetrics() as Record<string, unknown>;
}

export function formatPrometheus(metrics: Record<string, unknown>): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === "number") {
      const name = `buntime_${key.replace(/([A-Z])/g, "_$1").toLowerCase()}`;
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${value}`);
    }
  }

  return lines.join("\n");
}
