import { useEffect, useState } from "react";
import { CorsTab } from "~/components/tabs/cors-tab";
import { OverviewTab } from "~/components/tabs/overview-tab";
import { RateLimitTab } from "~/components/tabs/rate-limit-tab";
import { ShellTab } from "~/components/tabs/shell-tab";
import { ScrollArea } from "~/components/ui/scroll-area";
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

  return (
    <ScrollArea className="h-full">
      <div className="m-4 space-y-4">
        {/* Error Banner */}
        {error && !isConnected && (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList variant="line">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="rate-limit">Rate Limit</TabsTrigger>
            <TabsTrigger value="cors">CORS</TabsTrigger>
            <TabsTrigger value="shell">Shell</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab data={data} isLoading={!isConnected && !data} />
          </TabsContent>

          <TabsContent value="rate-limit">
            <RateLimitTab
              metrics={data?.rateLimit?.metrics ?? null}
              config={data?.rateLimit?.config ?? null}
              initialLogs={data?.recentLogs ?? []}
            />
          </TabsContent>

          <TabsContent value="cors">
            <CorsTab cors={data?.cors ?? null} />
          </TabsContent>

          <TabsContent value="shell">
            <ShellTab shell={data?.shell ?? null} />
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
}
