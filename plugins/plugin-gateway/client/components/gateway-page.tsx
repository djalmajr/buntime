import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@zomme/shadcn-react";
import { useEffect, useState } from "react";

interface GatewayStats {
  cache?: {
    maxEntries: number;
    size: number;
  } | null;
  cors?: {
    enabled: boolean;
  } | null;
  rateLimit?: {
    enabled: boolean;
  } | null;
}

/**
 * Get the base path for API calls from the base tag.
 */
function getApiBase(): string {
  const base = document.querySelector("base");
  if (base) {
    const href = base.getAttribute("href") || "";
    return href.replace(/\/$/, "") || "/gateway";
  }
  return "/gateway";
}

export function GatewayPage() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState<GatewayStats | null>(null);

  const basePath = getApiBase();

  const loadStats = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${basePath}/api/gateway/stats`);
      const data = await response.json();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, [basePath]);

  return (
    <div className="m-4 space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Gateway Dashboard</h1>
            <p className="text-sm text-muted-foreground">Monitor and manage gateway features</p>
          </div>
          <Button disabled={isLoading} size="sm" onClick={loadStats}>
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Error Loading Stats</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      )}

      {stats?.cache && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <span className="text-primary">💾</span>
              </div>
              <div>
                <CardTitle>Cache</CardTitle>
                <CardDescription>HTTP response cache statistics</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Entries</p>
                <p className="text-2xl font-bold">{stats.cache.size.toLocaleString()}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Max Entries</p>
                <p className="text-2xl font-bold">{stats.cache.maxEntries.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {stats?.rateLimit && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <span className="text-primary">⚡</span>
              </div>
              <div>
                <CardTitle>Rate Limit</CardTitle>
                <CardDescription>Request rate limiting configuration</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Status</p>
              <p className="text-2xl font-bold">
                {stats.rateLimit.enabled ? "Enabled" : "Disabled"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {stats?.cors && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <span className="text-primary">🌐</span>
              </div>
              <div>
                <CardTitle>CORS</CardTitle>
                <CardDescription>Cross-Origin Resource Sharing configuration</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Status</p>
              <p className="text-2xl font-bold">{stats.cors.enabled ? "Enabled" : "Disabled"}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
