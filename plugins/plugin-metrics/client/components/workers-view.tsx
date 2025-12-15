import { useCallback, useEffect, useState } from "react";
import { Icon } from "~/components/icon";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import type { MetricsSSEData } from "~/helpers/sse";
import { api } from "~/utils/api";

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

interface WorkerStat {
  errors: number;
  id: string;
  requests: number;
  uptime: number;
}

interface StatsData {
  pool: MetricsSSEData["pool"];
  workers: WorkerStat[];
}

export function WorkersView() {
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<StatsData | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.stats.$get();
      const data = (await response.json()) as MetricsSSEData;

      // Convert workers object to array (API returns Record<string, WorkerStat>)
      const workersObj = data.workers as unknown as Record<string, Omit<WorkerStat, "id">>;
      const workersArray = Object.entries(workersObj).map(([id, worker]) => ({
        id,
        ...worker,
      }));

      setStats({
        pool: data.pool,
        workers: workersArray,
      });
      setLastUpdate(new Date());
    } catch (error) {
      console.error("Failed to fetch worker stats:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return (
    <ScrollArea className="h-full">
      <div className="m-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Workers</h1>
            <p className="text-muted-foreground">Detailed statistics for all active workers</p>
          </div>
          <Button disabled={loading} onClick={fetchStats}>
            {loading ? (
              <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
            ) : (
              <Icon className="size-4" icon="lucide:refresh-cw" />
            )}
            Refresh
          </Button>
        </div>

        {stats && (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Workers</CardTitle>
                  <Icon className="size-4 text-muted-foreground" icon="lucide:users" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.workers.length}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Workers</CardTitle>
                  <Icon className="size-4 text-muted-foreground" icon="lucide:activity" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.pool.activeWorkers}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Idle Workers</CardTitle>
                  <Icon className="size-4 text-muted-foreground" icon="lucide:pause-circle" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.pool.idleWorkers}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Requests</CardTitle>
                  <Icon className="size-4 text-muted-foreground" icon="lucide:bar-chart" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {stats.workers.reduce((sum, w) => sum + w.requests, 0)}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Worker Statistics</CardTitle>
                    <CardDescription>Statistics for each worker in the pool</CardDescription>
                  </div>
                  {lastUpdate && (
                    <div className="text-sm text-muted-foreground">
                      Last update: {lastUpdate.toLocaleTimeString()}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {stats.workers.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Worker ID</TableHead>
                        <TableHead>Uptime</TableHead>
                        <TableHead className="text-right">Requests</TableHead>
                        <TableHead className="text-right">Errors</TableHead>
                        <TableHead className="text-right">Error Rate</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.workers.map((worker) => {
                        const errorRate =
                          worker.requests > 0
                            ? ((worker.errors / worker.requests) * 100).toFixed(2)
                            : "0.00";

                        return (
                          <TableRow key={worker.id}>
                            <TableCell className="font-mono text-xs">Worker {worker.id}</TableCell>
                            <TableCell>{formatUptime(worker.uptime)}</TableCell>
                            <TableCell className="text-right">{worker.requests}</TableCell>
                            <TableCell className="text-right">
                              {worker.errors > 0 ? (
                                <span className="text-destructive">{worker.errors}</span>
                              ) : (
                                worker.errors
                              )}
                            </TableCell>
                            <TableCell className="text-right">{errorRate}%</TableCell>
                            <TableCell>
                              <Badge variant={worker.errors > 0 ? "destructive" : "default"}>
                                {worker.errors > 0 ? "Error" : "Healthy"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Icon className="mb-2 size-12 text-muted-foreground" icon="lucide:inbox" />
                    <p className="text-sm text-muted-foreground">
                      No workers are currently running
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {!stats && (
          <Card>
            <CardContent className="flex items-center justify-center py-8">
              <Icon className="size-8 animate-spin text-muted-foreground" icon="lucide:loader-2" />
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}
