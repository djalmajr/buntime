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

// Get base path from <base> tag or default to ""
function getBasePath(): string {
  const base = document.querySelector("base");
  if (base) {
    const href = base.getAttribute("href") || "";
    return href.replace(/\/$/, "");
  }
  return "";
}

const levelColors: Record<LogLevel, string> = {
  debug: "bg-gray-100 text-gray-700",
  error: "bg-red-100 text-red-700",
  info: "bg-blue-100 text-blue-700",
  warn: "bg-yellow-100 text-yellow-700",
};

const levelButtonColors: Record<LogLevel | "all", string> = {
  all: "bg-gray-100 hover:bg-gray-200",
  debug: "bg-gray-100 hover:bg-gray-200 text-gray-700",
  error: "bg-red-100 hover:bg-red-200 text-red-700",
  info: "bg-blue-100 hover:bg-blue-200 text-blue-700",
  warn: "bg-yellow-100 hover:bg-yellow-200 text-yellow-700",
};

export function LogsTable() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<LogStats>({
    counts: { debug: 0, error: 0, info: 0, warn: 0 },
    total: 0,
  });
  const [filter, setFilter] = useState<LogLevel | null>(null);
  const [loading, setLoading] = useState(true);

  const basePath = getBasePath();

  useEffect(() => {
    async function fetchLogs() {
      try {
        const params = new URLSearchParams();
        if (filter) params.set("level", filter);
        params.set("limit", "100");

        const res = await fetch(`${basePath}/api/logs?${params}`);
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

    // Setup SSE for real-time updates
    const eventSource = new EventSource(`${basePath}/api/logs/sse`);
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
    await fetch(`${basePath}/api/logs/clear`, { method: "POST" });
    setLogs([]);
    setStats({ counts: { debug: 0, error: 0, info: 0, warn: 0 }, total: 0 });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold mb-2">Logs</h1>
          <p className="text-sm text-gray-500">
            Total: {stats.total} entries ({stats.counts.error} errors, {stats.counts.warn} warnings)
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className={`px-3 py-1.5 text-sm rounded ${filter === null ? "ring-2 ring-offset-1 ring-gray-400" : ""} ${levelButtonColors.all}`}
            onClick={() => setFilter(null)}
            type="button"
          >
            All
          </button>
          <button
            className={`px-3 py-1.5 text-sm rounded ${filter === "error" ? "ring-2 ring-offset-1 ring-red-400" : ""} ${levelButtonColors.error}`}
            onClick={() => setFilter("error")}
            type="button"
          >
            Errors
          </button>
          <button
            className={`px-3 py-1.5 text-sm rounded ${filter === "warn" ? "ring-2 ring-offset-1 ring-yellow-400" : ""} ${levelButtonColors.warn}`}
            onClick={() => setFilter("warn")}
            type="button"
          >
            Warnings
          </button>
          <button
            className={`px-3 py-1.5 text-sm rounded ${filter === "info" ? "ring-2 ring-offset-1 ring-blue-400" : ""} ${levelButtonColors.info}`}
            onClick={() => setFilter("info")}
            type="button"
          >
            Info
          </button>
          <button
            className="px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 rounded ml-4"
            onClick={handleClear}
            type="button"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-3 py-2 text-xs font-medium text-gray-500">Time</th>
              <th className="px-3 py-2 text-xs font-medium text-gray-500">Level</th>
              <th className="px-3 py-2 text-xs font-medium text-gray-500">Source</th>
              <th className="px-3 py-2 text-xs font-medium text-gray-500">Message</th>
              <th className="px-3 py-2 text-xs font-medium text-gray-500">Meta</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-gray-500" colSpan={5}>
                  No logs yet
                </td>
              </tr>
            ) : (
              logs.map((entry, idx) => (
                <tr className="border-b hover:bg-gray-50" key={`${entry.timestamp}-${idx}`}>
                  <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${levelColors[entry.level]}`}
                    >
                      {entry.level}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-600 font-mono">{entry.source}</td>
                  <td className="px-3 py-2 text-sm">{entry.message}</td>
                  <td className="px-3 py-2 text-xs text-gray-400 font-mono">
                    {entry.meta ? JSON.stringify(entry.meta) : "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
