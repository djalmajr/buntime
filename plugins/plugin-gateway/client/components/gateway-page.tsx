import { useEffect, useState } from "react";
import { CorsTab } from "~/components/tabs/cors-tab";
import { LogsTab } from "~/components/tabs/logs-tab";
import { OverviewTab } from "~/components/tabs/overview-tab";
import { RateLimitTab } from "~/components/tabs/rate-limit-tab";
import { ShellTab } from "~/components/tabs/shell-tab";
import { Badge } from "~/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { createGatewaySSE, type GatewaySSEData } from "~/helpers/sse";

export function GatewayPage() {
  const [data, setData] = useState<GatewaySSEData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let eventSource: EventSource | null = null;

    const connect = () => {
      eventSource = createGatewaySSE((sseData) => {
        setData(sseData);
        setIsConnected(true);
        setError(null);
      });

      eventSource.onerror = () => {
        setIsConnected(false);
        setError("Connection lost. Reconnecting...");

        // Reconnect after a delay
        setTimeout(() => {
          if (eventSource) {
            eventSource.close();
          }
          connect();
        }, 3000);
      };
    };

    connect();

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, []);

  const handleRefresh = () => {
    // Force a reconnect to get fresh data
    // The SSE connection auto-refreshes, but we can trigger a manual state update here
  };

  return (
    <div className="m-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Gateway Dashboard</h1>
          <p className="text-sm text-muted-foreground">Monitor and manage gateway features</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isConnected ? "success" : "destructive"} className="animate-pulse">
            {isConnected ? "Live" : "Disconnected"}
          </Badge>
          {data && (
            <span className="text-xs text-muted-foreground">
              Updated: {new Date(data.timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {error && !isConnected && (
        <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-lg">{error}</div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="rate-limit">
            Rate Limit
            {data?.rateLimit && (
              <Badge variant="secondary" size="sm" className="ml-1.5">
                {data.rateLimit.metrics.blockedRequests}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="cors">CORS</TabsTrigger>
          <TabsTrigger value="shell">Shell</TabsTrigger>
          <TabsTrigger value="logs">
            Logs
            {data?.recentLogs && data.recentLogs.length > 0 && (
              <Badge variant="secondary" size="sm" className="ml-1.5">
                {data.recentLogs.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab data={data} isLoading={!isConnected && !data} />
        </TabsContent>

        <TabsContent value="rate-limit">
          <RateLimitTab
            metrics={data?.rateLimit?.metrics ?? null}
            config={data?.rateLimit?.config ?? null}
          />
        </TabsContent>

        <TabsContent value="cors">
          <CorsTab
            config={
              data?.cors
                ? {
                    enabled: data.cors.enabled,
                    origin: data.cors.origin,
                    credentials: data.cors.credentials,
                    methods: data.cors.methods,
                  }
                : null
            }
          />
        </TabsContent>

        <TabsContent value="shell">
          <ShellTab
            enabled={data?.shell?.enabled ?? false}
            dir={data?.shell?.dir ?? null}
            excludes={data?.shell?.excludes ?? []}
            onRefresh={handleRefresh}
          />
        </TabsContent>

        <TabsContent value="logs">
          <LogsTab initialLogs={data?.recentLogs ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
