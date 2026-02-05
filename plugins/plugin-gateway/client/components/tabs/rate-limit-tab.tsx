import { useEffect, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Skeleton } from "~/components/ui/skeleton";
import { type BucketInfo, gatewayApi, type RateLimitMetrics } from "~/lib/api";

interface RateLimitTabProps {
  metrics: RateLimitMetrics | null;
  config: { requests: number; window: string; keyBy: string } | null;
}

export function RateLimitTab({ metrics, config }: RateLimitTabProps) {
  const [buckets, setBuckets] = useState<BucketInfo[]>([]);
  const [isLoadingBuckets, setIsLoadingBuckets] = useState(false);
  const [isClearing, setIsClearing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBuckets = async () => {
    setIsLoadingBuckets(true);
    setError(null);
    try {
      const data = await gatewayApi.getRateLimitBuckets({ limit: 50, sortBy: "lastActivity" });
      setBuckets(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load buckets");
    } finally {
      setIsLoadingBuckets(false);
    }
  };

  const clearBucket = async (key: string) => {
    setIsClearing(key);
    try {
      await gatewayApi.clearRateLimitBucket(key);
      setBuckets((prev) => prev.filter((b) => b.key !== key));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear bucket");
    } finally {
      setIsClearing(null);
    }
  };

  const clearAllBuckets = async () => {
    setIsClearing("all");
    try {
      await gatewayApi.clearAllRateLimitBuckets();
      setBuckets([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear buckets");
    } finally {
      setIsClearing(null);
    }
  };

  useEffect(() => {
    loadBuckets();
    // Refresh buckets every 5 seconds
    const interval = setInterval(loadBuckets, 5000);
    return () => clearInterval(interval);
  }, []);

  if (!config) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Rate limiting is not enabled</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuration</CardTitle>
          <CardDescription>Current rate limiting settings</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Requests per Window</p>
              <p className="text-2xl font-bold">{config.requests}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Window Duration</p>
              <p className="text-2xl font-bold">{config.window}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Key By</p>
              <p className="text-2xl font-bold capitalize">{config.keyBy}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Metrics</CardTitle>
          <CardDescription>Request statistics since startup</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Total</p>
              <p className="text-2xl font-bold">{(metrics?.totalRequests ?? 0).toLocaleString()}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Allowed</p>
              <p className="text-2xl font-bold text-green-600">
                {(metrics?.allowedRequests ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Blocked</p>
              <p className="text-2xl font-bold text-red-600">
                {(metrics?.blockedRequests ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Block Rate</p>
              <p className="text-2xl font-bold">
                {metrics?.totalRequests
                  ? ((metrics.blockedRequests / metrics.totalRequests) * 100).toFixed(1)
                  : "0"}
                %
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Active Buckets */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Active Buckets</CardTitle>
            <CardDescription>
              {buckets.length} client{buckets.length !== 1 ? "s" : ""} tracked
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadBuckets} disabled={isLoadingBuckets}>
              Refresh
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={clearAllBuckets}
              disabled={isClearing !== null || buckets.length === 0}
            >
              Clear All
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 p-2 bg-destructive/10 text-destructive text-sm rounded">
              {error}
            </div>
          )}

          {isLoadingBuckets && buckets.length === 0 ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : buckets.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">No active buckets</p>
          ) : (
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {buckets.map((bucket) => (
                  <div
                    key={bucket.key}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <Badge
                        variant={
                          bucket.tokens < config.requests * 0.2 ? "destructive" : "secondary"
                        }
                      >
                        {bucket.tokens.toFixed(0)} / {config.requests}
                      </Badge>
                      <span className="font-mono text-sm">{bucket.key}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-muted-foreground">
                        {formatTimeSince(bucket.lastActivity)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => clearBucket(bucket.key)}
                        disabled={isClearing !== null}
                      >
                        {isClearing === bucket.key ? "..." : "Clear"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatTimeSince(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}
