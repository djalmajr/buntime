import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@zomme/shadcn-react";
import { useEffect, useState } from "react";

type LogLevel = "debug" | "error" | "info" | "warn";

interface LogEntry {
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
  source: string;
  timestamp: string;
}

interface LogStats {
  counts: Record<LogLevel, number>;
  newest?: string;
  oldest?: string;
  total: number;
}

/**
 * Get the base path for API calls.
 * When loaded via fragment-outlet, extracts plugin path from src attribute.
 * Falls back to base tag for standalone mode.
 */
function getApiBase(): string {
  const rootElement = document.getElementById("plugin-logs-root");
  if (!rootElement) return "/logs";

  // Fragment content is inside Shadow DOM, host is the fragment-outlet
  const rootNode = rootElement.getRootNode();
  if (rootNode instanceof ShadowRoot) {
    // Get the src attribute from fragment-outlet (this is where APIs are served)
    const outlet = rootNode.host;
    const src = outlet?.getAttribute("src");
    if (src) {
      // Extract the plugin path from src (e.g., "/logs" from "/logs/entries")
      const match = src.match(/^(\/[^/]+)/);
      return match?.[1] || "/logs";
    }
  }

  // Fallback: read from base tag (standalone mode)
  const base = document.querySelector("base");
  if (base) {
    const href = base.getAttribute("href") || "";
    return href.replace(/\/$/, "") || "/logs";
  }
  return "/logs";
}

const levelVariant: Record<LogLevel, "debug" | "info" | "warning" | "destructive"> = {
  debug: "debug",
  error: "destructive",
  info: "info",
  warn: "warning",
};

export function LogsTable() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<LogStats>({
    counts: { debug: 0, error: 0, info: 0, warn: 0 },
    total: 0,
  });
  const [filter, setFilter] = useState<LogLevel | null>(null);
  const [loading, setLoading] = useState(true);

  const basePath = getApiBase();

  useEffect(() => {
    async function fetchLogs() {
      try {
        const params = new URLSearchParams();
        if (filter) params.set("level", filter);
        params.set("limit", "100");

        const res = await fetch(`${basePath}/api?${params}`);
        const data = await res.json();
        setLogs(data.logs);
        setStats(data.stats);
      } catch (err) {
        console.error("Failed to fetch logs:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchLogs();

    const eventSource = new EventSource(`${basePath}/api/sse`);
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.logs?.length) {
        setLogs((prev) => [...data.logs, ...prev].slice(0, 100));
      }
      if (data.stats) {
        setStats(data.stats);
      }
    };

    return () => eventSource.close();
  }, [basePath, filter]);

  const handleClear = async () => {
    await fetch(`${basePath}/api/clear`, { method: "POST" });
    setLogs([]);
    setStats({ counts: { debug: 0, error: 0, info: 0, warn: 0 }, total: 0 });
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl">Logs</CardTitle>
              <CardDescription>
                Total: {stats.total} entries ({stats.counts.error} errors, {stats.counts.warn}{" "}
                warnings)
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={filter === null ? "default" : "outline"}
                onClick={() => setFilter(null)}
              >
                All
              </Button>
              <Button
                size="sm"
                variant={filter === "error" ? "destructive" : "outline"}
                onClick={() => setFilter("error")}
              >
                Errors
              </Button>
              <Button
                size="sm"
                variant={filter === "warn" ? "secondary" : "outline"}
                onClick={() => setFilter("warn")}
              >
                Warnings
              </Button>
              <Button
                size="sm"
                variant={filter === "info" ? "secondary" : "outline"}
                onClick={() => setFilter("info")}
              >
                Info
              </Button>
              <Button className="ml-4" size="sm" variant="outline" onClick={handleClear}>
                Clear
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Meta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell className="py-8 text-center text-muted-foreground" colSpan={5}>
                    No logs yet
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((entry, idx) => (
                  <TableRow key={`${entry.timestamp}-${idx}`}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={levelVariant[entry.level]}>{entry.level}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {entry.source}
                    </TableCell>
                    <TableCell>{entry.message}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {entry.meta ? JSON.stringify(entry.meta) : "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
