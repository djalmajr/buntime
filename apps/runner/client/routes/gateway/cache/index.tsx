import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ScrollArea } from "~/components/ui/scroll-area";
import { gatewayApi, type InvalidateResponse } from "~/helpers/gateway-api";
import { PageHeader } from "~/routes/-components/page-header";

function CacheManagement() {
  const { t } = useTranslation("gateway/cache");
  const [isLoading, setIsLoading] = useState(false);
  const [key, setKey] = useState("");
  const [pattern, setPattern] = useState("");
  const [result, setResult] = useState<InvalidateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleInvalidateByKey = async () => {
    if (!key.trim()) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await gatewayApi.invalidateCache({ key: key.trim() });
      setResult(response);
      setKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleInvalidateByPattern = async () => {
    if (!pattern.trim()) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await gatewayApi.invalidateCache({ pattern: pattern.trim() });
      setResult(response);
      setPattern("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearAll = async () => {
    setIsLoading(true);
    setError(null);
    setResult(null);
    setShowConfirm(false);

    try {
      const response = await gatewayApi.invalidateCache({});
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="m-4 space-y-4">
        <PageHeader description={t("title.subtitle")} title={t("title.title")} />

        {/* Invalidate by Key */}
        <Card>
          <CardHeader>
            <CardTitle>{t("invalidateKey.title")}</CardTitle>
            <CardDescription>{t("invalidateKey.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cache-key">{t("invalidateKey.keyLabel")}</Label>
              <Input
                disabled={isLoading}
                id="cache-key"
                placeholder={t("invalidateKey.keyPlaceholder")}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </div>
            <Button disabled={isLoading || !key.trim()} onClick={handleInvalidateByKey}>
              <Icon className="mr-2 size-4" icon="lucide:key" />
              {t("invalidateKey.button")}
            </Button>
          </CardContent>
        </Card>

        {/* Invalidate by Pattern */}
        <Card>
          <CardHeader>
            <CardTitle>{t("invalidatePattern.title")}</CardTitle>
            <CardDescription>{t("invalidatePattern.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cache-pattern">{t("invalidatePattern.patternLabel")}</Label>
              <Input
                disabled={isLoading}
                id="cache-pattern"
                placeholder={t("invalidatePattern.patternPlaceholder")}
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
              />
            </div>
            <Button disabled={isLoading || !pattern.trim()} onClick={handleInvalidateByPattern}>
              <Icon className="mr-2 size-4" icon="lucide:search" />
              {t("invalidatePattern.button")}
            </Button>
          </CardContent>
        </Card>

        {/* Clear All Cache */}
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">{t("clearAll.title")}</CardTitle>
            <CardDescription>{t("clearAll.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!showConfirm ? (
              <Button
                disabled={isLoading}
                variant="destructive"
                onClick={() => setShowConfirm(true)}
              >
                <Icon className="mr-2 size-4" icon="lucide:trash-2" />
                {t("clearAll.button")}
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium">{t("clearAll.confirmMessage")}</p>
                <div className="flex gap-2">
                  <Button disabled={isLoading} variant="destructive" onClick={handleClearAll}>
                    <Icon className="mr-2 size-4" icon="lucide:check" />
                    {t("clearAll.confirmButton")}
                  </Button>
                  <Button
                    disabled={isLoading}
                    variant="outline"
                    onClick={() => setShowConfirm(false)}
                  >
                    <Icon className="mr-2 size-4" icon="lucide:x" />
                    {t("clearAll.cancelButton")}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Result */}
        {result && (
          <Card className="border-primary">
            <CardHeader>
              <CardTitle className="text-primary">{t("result.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {result.invalidated === "all"
                  ? t("result.allInvalidated")
                  : t("result.countInvalidated", { count: result.invalidated })}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {error && (
          <Card className="border-destructive">
            <CardHeader>
              <CardTitle className="text-destructive">{t("error.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{error}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}

export const Route = createFileRoute("/gateway/cache/")({
  component: CacheManagement,
});
