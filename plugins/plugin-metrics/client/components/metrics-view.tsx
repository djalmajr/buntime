import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Icon,
  ScrollArea,
} from "@zomme/shadcn-react";
import { useEffect, useState } from "react";
import { createMetricsSSE, type MetricsSSEData } from "~/helpers/sse";

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

export function MetricsView() {
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState<MetricsSSEData | null>(null);

  useEffect(() => {
    setConnected(false);
    const es = createMetricsSSE((data) => {
      setStats(data);
      setConnected(true);
    });

    es.addEventListener("open", () => {
      setConnected(true);
    });

    es.addEventListener("error", () => {
      setConnected(false);
    });

    return () => {
      es.close();
      setConnected(false);
    };
  }, []);

  const connectionStatus = connected ? "connected" : "connecting";

  return (
    <ScrollArea className="h-full">
      <div className="m-4 space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold">Overview</h1>
            <div
              className={cn(
                `size-3 rounded-full`,
                connected ? "bg-green-500" : "bg-yellow-500 animate-pulse",
              )}
              title={connectionStatus === "connected" ? "Connected" : "Connecting..."}
            />
          </div>
          <p className="text-muted-foreground">Real-time pool metrics and worker statistics</p>
        </div>

        {stats && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Requests</CardTitle>
                  <Icon className="size-4 text-muted-foreground" icon="lucide:activity" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.pool.totalRequests}</div>
                  <p className="text-xs text-muted-foreground">
                    {stats.pool.pendingRequests} pending
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Errors</CardTitle>
                  <Icon className="size-4 text-muted-foreground" icon="lucide:alert-circle" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.pool.totalErrors}</div>
                  <p className="text-xs text-muted-foreground">
                    {stats.pool.totalErrors > 0
                      ? `${((stats.pool.totalErrors / stats.pool.totalRequests) * 100).toFixed(2)}% error rate`
                      : "No errors"}
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Pool Statistics</CardTitle>
                <CardDescription>Monitor pool performance and worker health</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">Active Workers</p>
                    <p className="text-2xl font-bold">{stats.pool.activeWorkers}</p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">Idle Workers</p>
                    <p className="text-2xl font-bold">{stats.pool.idleWorkers}</p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">Pending Requests</p>
                    <p className="text-2xl font-bold">{stats.pool.pendingRequests}</p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">Total Requests</p>
                    <p className="text-2xl font-bold">{stats.pool.totalRequests}</p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">Total Errors</p>
                    <p className="text-2xl font-bold">{stats.pool.totalErrors}</p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">Uptime</p>
                    <p className="text-2xl font-bold">{formatUptime(stats.pool.uptime)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {!stats && connected && (
          <Card>
            <CardContent className="flex items-center justify-center py-8">
              <p className="text-muted-foreground">Waiting for metrics data...</p>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}
