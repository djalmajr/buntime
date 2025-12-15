import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { PoolStats } from "~/hooks/use-pool-stats";

interface PoolMetrics {
  activeWorkers: number;
  avgResponseTimeMs: number;
  hitRate: number;
  hits: number;
  misses: number;
  requestsPerSecond: number;
  totalRequests: number;
  totalWorkersCreated: number;
  totalWorkersFailed: number;
  uptimeMs: number;
}

interface PoolOverviewProps {
  stats: PoolStats;
}

export function PoolOverview({ stats }: PoolOverviewProps) {
  const pool = stats.pool as unknown as PoolMetrics;

  const formatUptime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Active Workers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{pool.activeWorkers}</div>
          <p className="text-xs text-muted-foreground">
            {pool.totalWorkersCreated} created · {pool.totalWorkersFailed} failed
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Requests/sec</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{pool.requestsPerSecond.toFixed(2)}</div>
          <p className="text-xs text-muted-foreground">{pool.totalRequests} total requests</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Avg Latency</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{pool.avgResponseTimeMs.toFixed(0)}ms</div>
          <p className="text-xs text-muted-foreground">Uptime: {formatUptime(pool.uptimeMs)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Cache Hit Rate</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{pool.hitRate.toFixed(1)}%</div>
          <p className="text-xs text-muted-foreground">
            {pool.hits} hits · {pool.misses} misses
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
