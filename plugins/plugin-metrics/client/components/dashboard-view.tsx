import { usePoolStats } from "~/hooks/use-pool-stats";
import { MetricsCharts } from "./metrics-charts";
import { PoolOverview } from "./pool-overview";
import { WorkersList } from "./workers-list";

export function DashboardView() {
  const { error, isConnected, isLoading, stats } = usePoolStats();

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-bold text-destructive mb-2">Error Loading Stats</h2>
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
          {isConnected ? "Live updates via Server-Sent Events" : "Disconnected"}
        </div>
      </div>
    </div>
  );
}
