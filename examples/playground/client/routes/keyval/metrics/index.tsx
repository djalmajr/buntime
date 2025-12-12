import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { kv } from "~/helpers/kv";
import { PageHeader } from "~/routes/-components/page-header";

interface KvOperationMetrics {
  avgLatencyMs: number;
  count: number;
  errors: number;
}

interface KvMetrics {
  operations: {
    operations: Record<string, KvOperationMetrics>;
    totals: { errors: number; operations: number };
  };
  queue: { dlq: number; pending: number; processing: number; total: number };
  storage: { entries: number; sizeBytes: number };
}

function MetricsPage() {
  const { t } = useTranslation("keyval.metrics");
  const [metrics, setMetrics] = useState<KvMetrics | null>(null);
  const [prometheus, setPrometheus] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const jsonMetrics = (await kv.metrics()) as unknown as KvMetrics;
      setMetrics(jsonMetrics);
    } catch (error) {
      console.error("Metrics error:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPrometheus = useCallback(async () => {
    setLoading(true);
    try {
      const text = (await kv.metrics("prometheus")) as string;
      setPrometheus(text);
    } catch (error) {
      console.error("Prometheus error:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadMetrics();
    }, 5000);

    return () => clearInterval(interval);
  }, [autoRefresh, loadMetrics]);

  const totalOperations = metrics?.operations.totals.operations ?? 0;
  const totalErrors = metrics?.operations.totals.errors ?? 0;

  return (
    <ScrollArea className="h-full">
      <div className="m-4 space-y-4">
        <PageHeader description={t("description")} title={t("title")} />

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t("stats.totalKeys")}</CardDescription>
              <CardTitle className="text-2xl">{metrics?.storage.entries ?? "-"}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t("stats.queueMessages")}</CardDescription>
              <CardTitle className="text-2xl">{metrics?.queue.total ?? "-"}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t("stats.operations")}</CardDescription>
              <CardTitle className="text-2xl">{totalOperations}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t("stats.errors")}</CardDescription>
              <CardTitle className="text-2xl">{totalErrors}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Tabs defaultValue="json">
          <TabsList>
            <TabsTrigger value="json">
              <Icon className="size-4" icon="lucide:braces" />
              {t("tabs.json")}
            </TabsTrigger>
            <TabsTrigger value="prometheus">
              <Icon className="size-4" icon="lucide:activity" />
              {t("tabs.prometheus")}
            </TabsTrigger>
          </TabsList>

          <TabsContent className="space-y-4" value="json">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("json.title")}</CardTitle>
                    <CardDescription>{t("json.description")}</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={autoRefresh ? "default" : "outline"}
                      onClick={() => setAutoRefresh(!autoRefresh)}
                    >
                      {autoRefresh ? (
                        <>
                          <Icon className="size-4 animate-pulse" icon="lucide:radio" />
                          {t("json.autoRefreshOn")}
                        </>
                      ) : (
                        <>
                          <Icon className="size-4" icon="lucide:radio" />
                          {t("json.autoRefreshOff")}
                        </>
                      )}
                    </Button>
                    <Button disabled={loading} size="sm" onClick={loadMetrics}>
                      {loading ? (
                        <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
                      ) : (
                        <Icon className="size-4" icon="lucide:refresh-cw" />
                      )}
                      {t("json.refresh")}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {autoRefresh && (
                  <div className="mb-4">
                    <Badge variant="default">
                      <Icon className="size-3 animate-pulse" icon="lucide:radio" />
                      {t("json.refreshing")}
                    </Badge>
                  </div>
                )}
                <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-4 text-sm">
                  {metrics ? JSON.stringify(metrics, null, 2) : t("json.loading")}
                </pre>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent className="space-y-4" value="prometheus">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("prometheus.title")}</CardTitle>
                    <CardDescription>{t("prometheus.description")}</CardDescription>
                  </div>
                  <Button disabled={loading} size="sm" onClick={loadPrometheus}>
                    {loading ? (
                      <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
                    ) : (
                      <Icon className="size-4" icon="lucide:refresh-cw" />
                    )}
                    {t("prometheus.fetch")}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-4 text-sm font-mono">
                  {prometheus || t("prometheus.placeholder")}
                </pre>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
}

export const Route = createFileRoute("/keyval/metrics/")({
  component: MetricsPage,
  loader: () => ({ breadcrumb: "keyval:nav.metrics" }),
});
