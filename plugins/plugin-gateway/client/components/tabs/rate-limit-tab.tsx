import { useEffect, useMemo, useState } from "react";
import { DataTable } from "~/components/data-table/data-table";
import { DataTableColumnHeader } from "~/components/data-table/data-table-column-header";
import { type ColumnDef, useDataTable } from "~/components/data-table/use-data-table";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Icon } from "~/components/ui/icon";
import { Input } from "~/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { type BucketInfo, gatewayApi, type RateLimitMetrics } from "~/lib/api";
import { LogsTab } from "./logs-tab";

interface RateLimitConfig {
  requests: number;
  window: string;
  keyBy: string;
}

interface RateLimitTabProps {
  metrics: RateLimitMetrics | null;
  config: RateLimitConfig | null;
  initialLogs: import("~/lib/api").RequestLogEntry[];
}

export function RateLimitTab({ metrics, config, initialLogs }: RateLimitTabProps) {
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
    <Tabs defaultValue="config" className="space-y-4">
      <TabsList>
        <TabsTrigger value="config">Configuration</TabsTrigger>
        <TabsTrigger value="buckets">Active Buckets</TabsTrigger>
        <TabsTrigger value="blocked">Blocked Requests</TabsTrigger>
      </TabsList>

      <TabsContent value="config">
        <ConfigurationView config={config} metrics={metrics} />
      </TabsContent>

      <TabsContent value="buckets">
        <ActiveBucketsView config={config} />
      </TabsContent>

      <TabsContent value="blocked">
        <LogsTab initialLogs={initialLogs} />
      </TabsContent>
    </Tabs>
  );
}

function ConfigurationView({
  config,
  metrics,
}: {
  config: RateLimitConfig;
  metrics: RateLimitMetrics | null;
}) {
  return (
    <div className="space-y-4">
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
    </div>
  );
}

function ActiveBucketsView({ config }: { config: RateLimitConfig }) {
  const [buckets, setBuckets] = useState<BucketInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBuckets = async () => {
    setError(null);
    try {
      const data = await gatewayApi.getRateLimitBuckets({ limit: 1000, sortBy: "lastActivity" });
      setBuckets(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load buckets");
    } finally {
      setIsLoading(false);
    }
  };

  const clearBucket = async (key: string) => {
    await gatewayApi.clearRateLimitBucket(key);
    setBuckets((prev) => prev.filter((b) => b.key !== key));
  };

  const clearAll = async () => {
    setIsClearing(true);
    try {
      await gatewayApi.clearAllRateLimitBuckets();
      setBuckets([]);
    } finally {
      setIsClearing(false);
    }
  };

  useEffect(() => {
    loadBuckets();
    const interval = setInterval(loadBuckets, 5000);
    return () => clearInterval(interval);
  }, []);

  const columns = useMemo<ColumnDef<BucketInfo, unknown>[]>(
    () => [
      {
        accessorKey: "key",
        header: ({ column }) => <DataTableColumnHeader column={column} label="Client key" />,
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.key}</span>,
      },
      {
        accessorKey: "tokens",
        header: ({ column }) => <DataTableColumnHeader column={column} label="Tokens" />,
        cell: ({ row }) => {
          const low = row.original.tokens < config.requests * 0.2;
          return (
            <span className={low ? "font-medium text-destructive" : ""}>
              {row.original.tokens.toFixed(0)} / {config.requests}
            </span>
          );
        },
      },
      {
        accessorKey: "lastActivity",
        header: ({ column }) => <DataTableColumnHeader column={column} label="Last activity" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatTimeSince(row.original.lastActivity)}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableGlobalFilter: false,
        size: 80,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <Button onClick={() => clearBucket(row.original.key)} size="sm" variant="ghost">
              Clear
            </Button>
          </div>
        ),
      },
    ],
    [config.requests],
  );

  const { table, globalFilter, setGlobalFilter } = useDataTable({ columns, data: buckets });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Per-client token buckets currently tracked by the rate limiter (keyed by{" "}
        <code className="font-mono">{config.keyBy}</code>). Buckets refill over the configured
        window and are evicted after inactivity.
      </p>
      {error && (
        <div className="rounded bg-destructive/10 p-2 text-sm text-destructive">{error}</div>
      )}
      <DataTable isLoading={isLoading} labels={{ noResults: "No active buckets." }} table={table}>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Icon
              className="-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-muted-foreground"
              icon="lucide:search"
            />
            <Input
              className="h-9 pl-8"
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Search buckets by client key…"
              value={globalFilter}
            />
          </div>
          <Button onClick={loadBuckets} size="sm" variant="outline">
            <Icon className="size-4" icon="lucide:refresh-cw" />
            Refresh
          </Button>
          <Button
            disabled={isClearing || buckets.length === 0}
            onClick={clearAll}
            size="sm"
            variant="destructive"
          >
            Clear all
          </Button>
        </div>
      </DataTable>
    </div>
  );
}

function formatTimeSince(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}
