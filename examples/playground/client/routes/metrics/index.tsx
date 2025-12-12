import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ScrollArea } from "~/components/ui/scroll-area";
import { metricsApi, type StatsResponse } from "~/helpers/metrics-api";
import { PageHeader } from "~/routes/-components/page-header";

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

function MetricsDashboard() {
  const { t } = useTranslation("metrics");
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setConnected(false);
    const es = metricsApi.createSSEConnection((data) => {
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
        <PageHeader description={t("dashboard.description")} title={t("dashboard.title")} />

        {/* Connection Status */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{t("realtime.title")}</CardTitle>
              <Badge variant={connected ? "default" : "secondary"}>
                {connected ? (
                  <Icon className="mr-1 size-3" icon="lucide:wifi" />
                ) : (
                  <Icon className="mr-1 size-3 animate-pulse" icon="lucide:wifi-off" />
                )}
                {t(`realtime.${connectionStatus}`)}
              </Badge>
            </div>
          </CardHeader>
        </Card>

        {stats && (
          <>
            {/* Quick Stats Cards */}
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t("quickStats.workers")}</CardTitle>
                  <Icon className="size-4 text-muted-foreground" icon="lucide:users" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats.pool.activeWorkers}</div>
                  <p className="text-xs text-muted-foreground">
                    {stats.pool.idleWorkers} {t("poolStats.idleWorkers").toLowerCase()}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t("quickStats.requests")}</CardTitle>
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
                  <CardTitle className="text-sm font-medium">{t("quickStats.errors")}</CardTitle>
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

            {/* Pool Statistics */}
            <Card>
              <CardHeader>
                <CardTitle>{t("poolStats.title")}</CardTitle>
                <CardDescription>{t("dashboard.subtitle")}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {t("poolStats.activeWorkers")}
                    </p>
                    <p className="text-2xl font-bold">{stats.pool.activeWorkers}</p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">{t("poolStats.idleWorkers")}</p>
                    <p className="text-2xl font-bold">{stats.pool.idleWorkers}</p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {t("poolStats.pendingRequests")}
                    </p>
                    <p className="text-2xl font-bold">{stats.pool.pendingRequests}</p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {t("poolStats.totalRequests")}
                    </p>
                    <p className="text-2xl font-bold">{stats.pool.totalRequests}</p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">{t("poolStats.totalErrors")}</p>
                    <p className="text-2xl font-bold">{stats.pool.totalErrors}</p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">{t("poolStats.uptime")}</p>
                    <p className="text-2xl font-bold">{formatUptime(stats.pool.uptime)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Active Workers Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Active Workers</CardTitle>
                <CardDescription>
                  Currently running workers ({stats.workers.length})
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {stats.workers.map((worker) => (
                    <div
                      key={worker.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="size-4 text-primary" icon="lucide:box" />
                        <div>
                          <p className="text-sm font-medium">Worker {worker.id}</p>
                          <p className="text-xs text-muted-foreground">
                            Uptime: {formatUptime(worker.uptime)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        <div>
                          <p className="text-xs text-muted-foreground">Requests</p>
                          <p className="text-sm font-medium">{worker.requests}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Errors</p>
                          <p className="text-sm font-medium">{worker.errors}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {stats.workers.length === 0 && (
                    <p className="text-sm text-muted-foreground">No active workers</p>
                  )}
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

export const Route = createFileRoute("/metrics/")({
  component: MetricsDashboard,
});
