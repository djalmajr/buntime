import { useEffect, useState } from "react";

type HealthStatus = "healthy" | "degraded" | "unhealthy";

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

// Get base path from <base> tag or default to ""
function getBasePath(): string {
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

const statusColors: Record<HealthStatus, { bg: string; icon: string; ring: string; text: string }> =
  {
    degraded: { bg: "bg-yellow-100", icon: "!", ring: "ring-yellow-400", text: "text-yellow-700" },
    healthy: { bg: "bg-green-100", icon: "\u2713", ring: "ring-green-400", text: "text-green-700" },
    unhealthy: { bg: "bg-red-100", icon: "\u2717", ring: "ring-red-400", text: "text-red-700" },
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

    // Refresh every 10 seconds
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, [basePath]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="p-6">
        <div className="text-center text-gray-500">Failed to load health status</div>
      </div>
    );
  }

  const overall = statusColors[report.status];

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold">System Health</h1>
          <span
            className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${overall.bg} ${overall.text}`}
          >
            <span>{overall.icon}</span>
            {report.status.charAt(0).toUpperCase() + report.status.slice(1)}
          </span>
        </div>
        <p className="text-sm text-gray-500">
          Uptime: {formatUptime(report.uptime)} | Last checked:{" "}
          {new Date(report.timestamp).toLocaleTimeString()}
        </p>
      </div>

      <div className="bg-white rounded-lg border shadow-sm">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Component</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Message</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Latency</th>
            </tr>
          </thead>
          <tbody>
            {report.checks.map((check) => {
              const colors = statusColors[check.status];
              const latencyStr =
                check.latency !== undefined ? `${check.latency.toFixed(1)}ms` : "-";

              return (
                <tr className="border-b hover:bg-gray-50" key={check.name}>
                  <td className="px-4 py-3">
                    <span className="font-medium">{check.name}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${colors.bg} ${colors.text}`}
                    >
                      <span>{colors.icon}</span>
                      {check.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{check.message || "-"}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 font-mono">{latencyStr}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded"
          onClick={fetchHealth}
          type="button"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
