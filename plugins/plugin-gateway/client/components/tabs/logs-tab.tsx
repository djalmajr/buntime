import { useEffect, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Skeleton } from "~/components/ui/skeleton";
import { gatewayApi, type RequestLogEntry } from "~/lib/api";

interface LogsTabProps {
  initialLogs: RequestLogEntry[];
}

export function LogsTab({ initialLogs }: LogsTabProps) {
  const [logs, setLogs] = useState<RequestLogEntry[]>(initialLogs);
  const [isLoading, setIsLoading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "rateLimited" | "errors">("all");

  useEffect(() => {
    setLogs(initialLogs);
  }, [initialLogs]);

  const loadLogs = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const options: { limit?: number; rateLimited?: boolean; status?: number } = { limit: 100 };
      if (filter === "rateLimited") {
        options.rateLimited = true;
      } else if (filter === "errors") {
        options.status = 429;
      }
      const data = await gatewayApi.getLogs(options);
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setIsLoading(false);
    }
  };

  const clearLogs = async () => {
    setIsClearing(true);
    setError(null);
    try {
      await gatewayApi.clearLogs();
      setLogs([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear logs");
    } finally {
      setIsClearing(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [filter]);

  const filteredLogs = logs.filter((log) => {
    if (filter === "rateLimited") return log.rateLimited;
    if (filter === "errors") return log.status >= 400;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{logs.length}</div>
            <p className="text-xs text-muted-foreground">Total Logged</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-red-600">
              {logs.filter((l) => l.rateLimited).length}
            </div>
            <p className="text-xs text-muted-foreground">Rate Limited</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-yellow-600">
              {logs.filter((l) => l.status >= 400 && !l.rateLimited).length}
            </div>
            <p className="text-xs text-muted-foreground">Other Errors</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">
              {logs.length > 0
                ? (logs.reduce((sum, l) => sum + l.duration, 0) / logs.length).toFixed(0)
                : "0"}
              ms
            </div>
            <p className="text-xs text-muted-foreground">Avg Duration</p>
          </CardContent>
        </Card>
      </div>

      {/* Logs List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Request Logs</CardTitle>
            <CardDescription>
              {filteredLogs.length} request{filteredLogs.length !== 1 ? "s" : ""}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <div className="flex rounded-lg border overflow-hidden">
              <button
                className={`px-3 py-1 text-sm ${filter === "all" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                onClick={() => setFilter("all")}
              >
                All
              </button>
              <button
                className={`px-3 py-1 text-sm border-l ${filter === "rateLimited" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                onClick={() => setFilter("rateLimited")}
              >
                Rate Limited
              </button>
              <button
                className={`px-3 py-1 text-sm border-l ${filter === "errors" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                onClick={() => setFilter("errors")}
              >
                Errors
              </button>
            </div>
            <Button variant="outline" size="sm" onClick={loadLogs} disabled={isLoading}>
              Refresh
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={clearLogs}
              disabled={isClearing || logs.length === 0}
            >
              Clear
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 p-2 bg-destructive/10 text-destructive text-sm rounded">
              {error}
            </div>
          )}

          {isLoading && logs.length === 0 ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filteredLogs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {filter === "all"
                ? "No requests logged yet"
                : filter === "rateLimited"
                  ? "No rate limited requests"
                  : "No errors"}
            </p>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-1">
                {/* Header */}
                <div className="flex items-center gap-4 px-3 py-2 text-xs text-muted-foreground font-medium border-b">
                  <span className="w-16">Status</span>
                  <span className="w-16">Method</span>
                  <span className="flex-1">Path</span>
                  <span className="w-20 text-right">Duration</span>
                  <span className="w-28">IP</span>
                  <span className="w-24">Time</span>
                </div>
                {/* Rows */}
                {filteredLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-center gap-4 px-3 py-2 text-sm border-b last:border-0 hover:bg-muted/50"
                  >
                    <span className="w-16">
                      <Badge
                        variant={
                          log.rateLimited
                            ? "destructive"
                            : log.status >= 500
                              ? "destructive"
                              : log.status >= 400
                                ? "warning"
                                : "secondary"
                        }
                        size="sm"
                      >
                        {log.status}
                      </Badge>
                    </span>
                    <span className="w-16 font-mono text-xs">{log.method}</span>
                    <span className="flex-1 truncate font-mono text-xs" title={log.path}>
                      {log.path}
                    </span>
                    <span className="w-20 text-right text-muted-foreground">
                      {log.duration.toFixed(0)}ms
                    </span>
                    <span className="w-28 text-muted-foreground font-mono text-xs">{log.ip}</span>
                    <span className="w-24 text-muted-foreground text-xs">
                      {formatTime(log.timestamp)}
                    </span>
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

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
}
