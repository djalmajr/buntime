import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ScrollArea } from "~/components/ui/scroll-area";
import { metricsApi } from "~/helpers/metrics-api";
import { PageHeader } from "~/routes/-components/page-header";

function PrometheusPage() {
  const { t } = useTranslation("metrics.prometheus");
  const [metrics, setMetrics] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const data = await metricsApi.getPrometheus();
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
        <PageHeader
          actions={
            <Button disabled={loading} onClick={fetchMetrics}>
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

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t("metrics.title")}</CardTitle>
                <CardDescription>{t("metrics.description")}</CardDescription>
              </div>
              {lastUpdate && (
                <div className="text-sm text-muted-foreground">
                  {t("lastUpdate")}: {lastUpdate.toLocaleTimeString()}
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
            <CardTitle>{t("info.title")}</CardTitle>
            <CardDescription>{t("info.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-medium">{t("info.endpoint.label")}</p>
                <code className="text-xs text-muted-foreground">
                  GET /_/plugin-metrics/prometheus
                </code>
              </div>
              <div>
                <p className="font-medium">{t("info.format.label")}</p>
                <p className="text-muted-foreground">{t("info.format.value")}</p>
              </div>
              <div>
                <p className="font-medium">{t("info.usage.label")}</p>
                <p className="text-muted-foreground">{t("info.usage.value")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}

export const Route = createFileRoute("/metrics/prometheus/")({
  component: PrometheusPage,
  loader: () => ({ breadcrumb: "metrics:nav.prometheus" }),
});
