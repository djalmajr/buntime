import { useEffect, useMemo, useState } from "react";
import { DataTable } from "~/components/data-table/data-table";
import { DataTableColumnHeader } from "~/components/data-table/data-table-column-header";
import { type ColumnDef, useDataTable } from "~/components/data-table/use-data-table";
import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import { Input } from "~/components/ui/input";
import { gatewayApi, type RequestLogEntry } from "~/lib/api";

interface LogsTabProps {
  initialLogs: RequestLogEntry[];
}

export function LogsTab({ initialLogs }: LogsTabProps) {
  const [logs, setLogs] = useState<RequestLogEntry[]>(initialLogs);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = async () => {
    setError(null);
    try {
      const data = await gatewayApi.getLogs({ limit: 100 });
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

  // Blocked requests are only recorded server-side on 429s; fetch the full set
  // (the SSE payload only carries the latest few).
  useEffect(() => {
    loadLogs();
  }, []);

  const columns = useMemo<ColumnDef<RequestLogEntry, unknown>[]>(
    () => [
      {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} label="Status" />,
        size: 90,
        cell: ({ row }) => (
          <span className="font-mono text-xs font-medium text-destructive">
            {row.original.status}
          </span>
        ),
      },
      {
        accessorKey: "method",
        header: ({ column }) => <DataTableColumnHeader column={column} label="Method" />,
        size: 90,
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.method}</span>,
      },
      {
        accessorKey: "path",
        header: ({ column }) => <DataTableColumnHeader column={column} label="Path" />,
        cell: ({ row }) => (
          <span className="font-mono text-xs" title={row.original.path}>
            {row.original.path}
          </span>
        ),
      },
      {
        accessorKey: "duration",
        header: ({ column }) => <DataTableColumnHeader column={column} label="Duration" />,
        size: 110,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.duration.toFixed(0)}ms
          </span>
        ),
      },
      {
        accessorKey: "ip",
        header: ({ column }) => <DataTableColumnHeader column={column} label="IP" />,
        size: 150,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.ip}</span>
        ),
      },
      {
        accessorKey: "timestamp",
        header: ({ column }) => <DataTableColumnHeader column={column} label="Time" />,
        size: 120,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {new Date(row.original.timestamp).toLocaleTimeString()}
          </span>
        ),
      },
    ],
    [],
  );

  const { table, globalFilter, setGlobalFilter } = useDataTable({ columns, data: logs });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Requests rejected by rate limiting (HTTP 429). Only blocked requests are recorded here.
      </p>
      {error && (
        <div className="rounded bg-destructive/10 p-2 text-sm text-destructive">{error}</div>
      )}
      <DataTable
        isLoading={isLoading}
        labels={{ noResults: "No requests have been blocked by rate limiting yet." }}
        table={table}
      >
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Icon
              className="-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-muted-foreground"
              icon="lucide:search"
            />
            <Input
              className="h-9 pl-8"
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Search by path, method or IP…"
              value={globalFilter}
            />
          </div>
          <Button onClick={loadLogs} size="sm" variant="outline">
            <Icon className="size-4" icon="lucide:refresh-cw" />
            Refresh
          </Button>
          <Button
            disabled={isClearing || logs.length === 0}
            onClick={clearLogs}
            size="sm"
            variant="destructive"
          >
            Clear
          </Button>
        </div>
      </DataTable>
    </div>
  );
}
