import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Icon } from "~/components/ui/icon";
import { Skeleton } from "~/components/ui/skeleton";
import type { GatewaySSEData } from "~/helpers/sse";

interface OverviewTabProps {
  data: GatewaySSEData | null;
  isLoading: boolean;
}

function StatCard({
  title,
  value,
  description,
  icon,
  isLoading,
}: {
  title: string;
  value: string | number;
  description?: string;
  icon: string;
  isLoading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="size-4 text-muted-foreground" icon={icon} />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <>
            <div className="text-2xl font-bold">{value.toLocaleString()}</div>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function OverviewTab({ data, isLoading }: OverviewTabProps) {
  const metrics = data?.rateLimit?.metrics;
  const logsCount = data?.recentLogs?.length ?? 0;

  return (
    <div className="space-y-4">
      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Requests"
          value={metrics?.totalRequests ?? 0}
          description="Since startup"
          icon="lucide:activity"
          isLoading={isLoading}
        />
        <StatCard
          title="Allowed Requests"
          value={metrics?.allowedRequests ?? 0}
          description="Passed rate limit"
          icon="lucide:circle-check"
          isLoading={isLoading}
        />
        <StatCard
          title="Blocked Requests"
          value={metrics?.blockedRequests ?? 0}
          description="Rate limited"
          icon="lucide:ban"
          isLoading={isLoading}
        />
        <StatCard
          title="Active Buckets"
          value={metrics?.activeBuckets ?? 0}
          description="Unique clients"
          icon="lucide:layers"
          isLoading={isLoading}
        />
      </div>

      {/* Feature Details */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Rate Limit Config */}
        {data?.rateLimit && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="size-5 text-primary" icon="lucide:zap" />
                </div>
                <div>
                  <CardTitle className="text-base">Rate Limit</CardTitle>
                  <CardDescription>Current configuration</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Requests</dt>
                  <dd className="font-medium">{data.rateLimit.config.requests}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Window</dt>
                  <dd className="font-medium">{data.rateLimit.config.window}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Key By</dt>
                  <dd className="font-medium">{data.rateLimit.config.keyBy}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        )}

        {/* CORS Config */}
        {data?.cors?.enabled && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="size-5 text-primary" icon="lucide:globe" />
                </div>
                <div>
                  <CardTitle className="text-base">CORS</CardTitle>
                  <CardDescription>Per-domain rules</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Rules</dt>
                  <dd className="font-medium">{data.cors.rules.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Domains</dt>
                  <dd className="max-w-40 truncate font-medium">
                    {data.cors.rules.flatMap((r) => r.origins).join(", ") || "-"}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        )}

        {/* Shell Config */}
        {data?.shell?.enabled && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="size-5 text-primary" icon="lucide:terminal" />
                </div>
                <div>
                  <CardTitle className="text-base">Shell</CardTitle>
                  <CardDescription>Micro-frontend shell</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Directory</dt>
                  <dd className="font-medium truncate max-w-32" title={data.shell.dir}>
                    {data.shell.dir.split("/").pop()}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Excludes</dt>
                  <dd className="font-medium">{data.shell.excludes.length} apps</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Recent Activity */}
      {logsCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Activity</CardTitle>
            <CardDescription>Last {logsCount} requests</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data?.recentLogs?.slice(0, 5).map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between text-sm border-b border-border pb-2 last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        log.rateLimited
                          ? "destructive"
                          : log.status >= 400
                            ? "warning"
                            : "secondary"
                      }
                      size="sm"
                    >
                      {log.status}
                    </Badge>
                    <span className="font-mono text-xs">{log.method}</span>
                    <span className="truncate max-w-48">{log.path}</span>
                  </div>
                  <div className="flex items-center gap-4 text-muted-foreground">
                    <span>{log.duration.toFixed(0)}ms</span>
                    <span className="text-xs">{log.ip}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
