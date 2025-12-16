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
} from "@buntime/shadcn-ui";
import { useEffect, useState } from "react";

type HealthStatus = "degraded" | "healthy" | "unhealthy";

interface HealthCheck {
  details?: Record<string, unknown>;
  latency?: number;
  message?: string;
  name: string;
  status: HealthStatus;
}

interface HealthReport {
  checks: HealthCheck[];
  status: HealthStatus;
  timestamp: string;
  uptime: number;
}

function getBasePath(): string {
  // First, try to get base from fragment-outlet's data attribute
  // This is set when the fragment is loaded inside a shell (e.g., cpanel)
  const outlet = document.querySelector("fragment-outlet[data-fragment-base]");
  if (outlet) {
    const fragmentBase = outlet.getAttribute("data-fragment-base");
    if (fragmentBase) {
      return fragmentBase.replace(/\/$/, "");
    }
  }

  // Fall back to document's base tag (for standalone mode at /p/health)
  const base = document.querySelector("base");
  if (base) {
    const href = base.getAttribute("href") || "";
    return href.replace(/\/$/, "");
  }
  return "";
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

const statusVariant: Record<HealthStatus, "success" | "warning" | "destructive"> = {
  degraded: "warning",
  healthy: "success",
  unhealthy: "destructive",
};

const statusIcon: Record<HealthStatus, string> = {
  degraded: "!",
  healthy: "\u2713",
  unhealthy: "\u2717",
};

export function HealthDashboard() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);

  const basePath = getBasePath();

  const fetchHealth = async () => {
    try {
      const res = await fetch(`${basePath}/api/health`);
      const data = await res.json();
      setReport(data);
    } catch (err) {
      console.error("Failed to fetch health:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();

    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, [basePath]);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">Failed to load health status</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <CardTitle className="text-2xl">System Health</CardTitle>
            <Badge variant={statusVariant[report.status]}>
              <span>{statusIcon[report.status]}</span>
              {report.status.charAt(0).toUpperCase() + report.status.slice(1)}
            </Badge>
          </div>
          <CardDescription>
            Uptime: {formatUptime(report.uptime)} | Last checked:{" "}
            {new Date(report.timestamp).toLocaleTimeString()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Component</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Latency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.checks.map((check) => {
                const latencyStr =
                  check.latency !== undefined ? `${check.latency.toFixed(1)}ms` : "-";

                return (
                  <TableRow key={check.name}>
                    <TableCell className="font-medium">{check.name}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[check.status]}>
                        <span>{statusIcon[check.status]}</span>
                        {check.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{check.message || "-"}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{latencyStr}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="outline" onClick={fetchHealth}>
          Refresh
        </Button>
      </div>
    </div>
  );
}
