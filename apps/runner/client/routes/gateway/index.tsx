import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ScrollArea } from "~/components/ui/scroll-area";
import { type GatewayStats, gatewayApi } from "~/helpers/gateway-api";
import { PageHeader } from "~/routes/-components/page-header";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function GatewayDashboard() {
  const { t } = useTranslation("gateway");
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState<GatewayStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStats = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await gatewayApi.getStats();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  return (
    <ScrollArea className="h-full">
      <div className="m-4 space-y-4">
        <PageHeader
          actions={
            <Button disabled={isLoading} size="sm" onClick={loadStats}>
              <Icon className="mr-2 size-4" icon="lucide:refresh-cw" />
              {t("dashboard.refresh")}
            </Button>
          }
          description={t("dashboard.subtitle")}
          title={t("dashboard.title")}
        />

        {error && (
          <Card className="border-destructive">
            <CardHeader>
              <CardTitle className="text-destructive">{t("dashboard.error.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Cache Stats */}
        {stats?.cache && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="size-5 text-primary" icon="lucide:hard-drive" />
                </div>
                <div>
                  <CardTitle>{t("dashboard.cache.title")}</CardTitle>
                  <CardDescription>{t("dashboard.cache.description")}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{t("dashboard.cache.entries")}</p>
                  <p className="text-2xl font-bold">{stats.cache.entries.toLocaleString()}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{t("dashboard.cache.hits")}</p>
                  <p className="text-2xl font-bold">{stats.cache.hits.toLocaleString()}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{t("dashboard.cache.misses")}</p>
                  <p className="text-2xl font-bold">{stats.cache.misses.toLocaleString()}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{t("dashboard.cache.size")}</p>
                  <p className="text-2xl font-bold">{formatSize(stats.cache.size)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Rate Limit Stats */}
        {stats?.rateLimit && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="size-5 text-primary" icon="lucide:gauge" />
                </div>
                <div>
                  <CardTitle>{t("dashboard.rateLimit.title")}</CardTitle>
                  <CardDescription>{t("dashboard.rateLimit.description")}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{t("dashboard.rateLimit.status")}</p>
                <p className="text-2xl font-bold">
                  {stats.rateLimit.enabled
                    ? t("dashboard.rateLimit.enabled")
                    : t("dashboard.rateLimit.disabled")}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* CORS Stats */}
        {stats?.cors && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="size-5 text-primary" icon="lucide:globe" />
                </div>
                <div>
                  <CardTitle>{t("dashboard.cors.title")}</CardTitle>
                  <CardDescription>{t("dashboard.cors.description")}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">{t("dashboard.cors.status")}</p>
                <p className="text-2xl font-bold">
                  {stats.cors.enabled ? t("dashboard.cors.enabled") : t("dashboard.cors.disabled")}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}

export const Route = createFileRoute("/gateway/")({
  component: GatewayDashboard,
});
