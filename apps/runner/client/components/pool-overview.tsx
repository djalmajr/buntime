import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { PoolStats } from "~/hooks/use-pool-stats";

interface PoolOverviewProps {
  stats: PoolStats;
}

export function PoolOverview({ stats }: PoolOverviewProps) {
  const { t } = useTranslation();
  const { pool } = stats;

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
          <CardTitle className="text-sm font-medium">{t("dashboard.metrics.workers")}</CardTitle>
          <Icon className="size-5 text-muted-foreground" icon="lucide:server" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{pool.activeWorkers}</div>
          <p className="text-xs text-muted-foreground">
            {pool.totalWorkersCreated} {t("dashboard.metrics.created")} · {pool.totalWorkersFailed}{" "}
            {t("dashboard.metrics.failed")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            {t("dashboard.metrics.requestsPerSecond")}
          </CardTitle>
          <Icon className="size-5 text-muted-foreground" icon="lucide:activity" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{pool.requestsPerSecond.toFixed(2)}</div>
          <p className="text-xs text-muted-foreground">
            {pool.totalRequests} {t("dashboard.metrics.totalRequests")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{t("dashboard.metrics.avgLatency")}</CardTitle>
          <Icon className="size-5 text-muted-foreground" icon="lucide:clock" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{pool.avgResponseTimeMs.toFixed(0)}ms</div>
          <p className="text-xs text-muted-foreground">
            {t("dashboard.metrics.uptime")}: {formatUptime(pool.uptimeMs)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            {t("dashboard.metrics.cacheHitRate")}
          </CardTitle>
          <Icon className="size-5 text-muted-foreground" icon="lucide:percent" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{pool.hitRate.toFixed(1)}%</div>
          <p className="text-xs text-muted-foreground">
            {pool.hits} {t("dashboard.metrics.hits")} · {pool.misses}{" "}
            {t("dashboard.metrics.misses")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
