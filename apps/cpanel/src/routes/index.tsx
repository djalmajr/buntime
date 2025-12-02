import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MetricsCharts } from "~/components/metrics-charts";
import { PoolOverview } from "~/components/pool-overview";
import { WorkersList } from "~/components/workers-list";
import { usePoolStats } from "~/hooks/use-pool-stats";

function DashboardPage() {
  const { t } = useTranslation();
  const { error, isConnected, isLoading, stats } = usePoolStats();

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">{t("dashboard.loading")}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-bold text-destructive mb-2">{t("dashboard.errorTitle")}</h2>
          <p className="text-muted-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  return (
    <div className="space-y-8">
      <PoolOverview stats={stats} />
      <MetricsCharts stats={stats} />
      <WorkersList stats={stats} />
      <div className="text-center text-sm text-muted-foreground">
        <div className="flex items-center justify-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"}`}
          />
          {isConnected ? t("dashboard.connected") : t("dashboard.disconnected")}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/")({
  component: DashboardPage,
  loader: () => ({ breadcrumb: "common:nav.dashboard" }),
});
