import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { metricsApi, type StatsResponse } from "~/helpers/metrics-api";
import { PageHeader } from "~/routes/-components/page-header";

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

function WorkersPage() {
  const { t } = useTranslation("metrics.workers");
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const data = await metricsApi.getStats();
      setStats(data);
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
        <PageHeader
          actions={
            <Button disabled={loading} onClick={fetchStats}>
              {loading ? (
                <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
              ) : (
                <Icon className="size-4" icon="lucide:refresh-cw" />
              )}
              {t("refresh")}
            </Button>
          }
          description={t("description")}
          title={t("title")}
        />

        {stats && (
          <>
            {/* Summary Cards */}
            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t("summary.totalWorkers")}</CardTitle>
                  <Icon className="size-4 text-muted-foreground" icon="lucide:users" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.workers.length}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {t("summary.activeWorkers")}
                  </CardTitle>
                  <Icon className="size-4 text-muted-foreground" icon="lucide:activity" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.pool.activeWorkers}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t("summary.idleWorkers")}</CardTitle>
                  <Icon className="size-4 text-muted-foreground" icon="lucide:pause-circle" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.pool.idleWorkers}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {t("summary.totalRequests")}
                  </CardTitle>
                  <Icon className="size-4 text-muted-foreground" icon="lucide:bar-chart" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {stats.workers.reduce((sum, w) => sum + w.requests, 0)}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Workers Table */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("table.title")}</CardTitle>
                    <CardDescription>{t("table.description")}</CardDescription>
                  </div>
                  {lastUpdate && (
                    <div className="text-sm text-muted-foreground">
                      {t("lastUpdate")}: {lastUpdate.toLocaleTimeString()}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {stats.workers.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("table.columns.id")}</TableHead>
                        <TableHead>{t("table.columns.uptime")}</TableHead>
                        <TableHead className="text-right">{t("table.columns.requests")}</TableHead>
                        <TableHead className="text-right">{t("table.columns.errors")}</TableHead>
                        <TableHead className="text-right">{t("table.columns.errorRate")}</TableHead>
                        <TableHead>{t("table.columns.status")}</TableHead>
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
                                {worker.errors > 0 ? t("status.error") : t("status.healthy")}
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
                    <p className="text-sm text-muted-foreground">{t("table.empty")}</p>
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

export const Route = createFileRoute("/metrics/workers/")({
  component: WorkersPage,
  loader: () => ({ breadcrumb: "metrics:nav.workers" }),
});
