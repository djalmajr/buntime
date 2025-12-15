import { useCallback, useEffect, useState } from "react";
import { Icon } from "~/components/icon";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ScrollArea } from "~/components/ui/scroll-area";
import { api } from "~/utils/api";

export function PrometheusView() {
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [metrics, setMetrics] = useState<string>("");

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.prometheus.$get();
      const data = await response.text();
      setMetrics(data);
      setLastUpdate(new Date());
    } catch (error) {
      console.error("Failed to fetch Prometheus metrics:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  return (
    <ScrollArea className="h-full">
      <div className="m-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Prometheus</h1>
            <p className="text-muted-foreground">View raw Prometheus metrics in text format</p>
          </div>
          <Button disabled={loading} onClick={fetchMetrics}>
            {loading ? (
              <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
            ) : (
              <Icon className="size-4" icon="lucide:refresh-cw" />
            )}
            Refresh
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Prometheus Metrics</CardTitle>
                <CardDescription>Raw metrics data from the runner pool</CardDescription>
              </div>
              {lastUpdate && (
                <div className="text-sm text-muted-foreground">
                  Last update: {lastUpdate.toLocaleTimeString()}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {metrics ? (
              <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs font-mono">
                {metrics}
              </pre>
            ) : (
              <div className="flex items-center justify-center py-8">
                <Icon
                  className="size-8 animate-spin text-muted-foreground"
                  icon="lucide:loader-2"
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Metrics Info</CardTitle>
            <CardDescription>Information about the Prometheus metrics endpoint</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-medium">Endpoint</p>
                <code className="text-xs text-muted-foreground">GET /api/prometheus</code>
              </div>
              <div>
                <p className="font-medium">Format</p>
                <p className="text-muted-foreground">Prometheus text exposition format</p>
              </div>
              <div>
                <p className="font-medium">Usage</p>
                <p className="text-muted-foreground">
                  Configure Prometheus to scrape this endpoint for monitoring
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}
