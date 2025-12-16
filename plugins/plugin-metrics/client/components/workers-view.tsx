import {
  Badge,
  type ColumnDef,
  DataTable,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  ScrollArea,
  useDataTable,
} from "@buntime/shadcn-ui";
import { useEffect, useMemo, useState } from "react";
import { createMetricsSSE, type MetricsSSEData, type WorkerData } from "~/helpers/sse";

const statusVariant = {
  active: "default",
  ephemeral: "secondary",
  idle: "secondary",
  offline: "outline",
} as const;

const statusLabel = {
  active: "Active",
  ephemeral: "Ephemeral",
  idle: "Idle",
  offline: "Offline",
} as const;

const columns: ColumnDef<WorkerData>[] = [
  {
    accessorKey: "id",
    header: "Worker ID",
    cell: ({ row }) => {
      const displayId = row.original.id.replace(/^(apps|plugins)@/, "");
      return <span className="font-mono text-xs">{displayId}</span>;
    },
  },
  {
    accessorKey: "avgResponseTimeMs",
    header: "Avg Time",
    maxSize: 100,
    minSize: 100,
    size: 100,
    cell: ({ row }) => (
      <span className="font-mono">{row.original.avgResponseTimeMs.toFixed(1)}ms</span>
    ),
  },
  {
    accessorKey: "requests",
    header: () => <span className="flex justify-end">Requests</span>,
    maxSize: 90,
    minSize: 90,
    size: 90,
    cell: ({ row }) => <span className="flex justify-end">{row.original.requests}</span>,
  },
  {
    accessorKey: "errors",
    header: () => <span className="flex justify-end">Errors</span>,
    maxSize: 70,
    minSize: 70,
    size: 70,
    cell: ({ row }) => (
      <span className="flex justify-end">
        {row.original.errors > 0 ? (
          <span className="text-destructive">{row.original.errors}</span>
        ) : (
          row.original.errors
        )}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    maxSize: 100,
    minSize: 100,
    size: 100,
    cell: ({ row }) => (
      <Badge variant={statusVariant[row.original.status]}>{statusLabel[row.original.status]}</Badge>
    ),
  },
];

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

export function WorkersView() {
  const [selectedWorker, setSelectedWorker] = useState<WorkerData | null>(null);
  const [stats, setStats] = useState<MetricsSSEData | null>(null);

  const data = useMemo(() => stats?.workers ?? [], [stats]);

  const { table } = useDataTable({
    columns,
    data,
  });

  useEffect(() => {
    const es = createMetricsSSE((data) => {
      setStats(data);
    });

    return () => {
      es.close();
    };
  }, []);

  return (
    <>
      <ScrollArea className="h-full">
        <div className="m-4 space-y-4">
          <div>
            <h1 className="text-3xl font-bold">Workers</h1>
            <p className="text-muted-foreground">Real-time statistics for all workers</p>
          </div>
          <DataTable
            isLoading={!stats}
            labels={{ noResults: "No workers are currently running" }}
            table={table}
            onRowClick={setSelectedWorker}
          />
        </div>
      </ScrollArea>
      <Drawer
        direction="right"
        open={!!selectedWorker}
        onOpenChange={(open: boolean) => !open && setSelectedWorker(null)}
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="font-mono text-sm">
              {selectedWorker?.id.replace(/^(apps|plugins)@/, "")}
            </DrawerTitle>
            <DrawerDescription>
              {selectedWorker?.status === "ephemeral"
                ? "Ephemeral"
                : selectedWorker?.status === "offline"
                  ? "Offline"
                  : "Persistent"}{" "}
              worker details
            </DrawerDescription>
          </DrawerHeader>
          {selectedWorker && (
            <div className="space-y-4 p-4">
              {selectedWorker.status === "ephemeral" && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground">Last Session</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Response Time</p>
                      <p className="font-mono text-lg font-semibold">
                        {selectedWorker.lastResponseTimeMs?.toFixed(1) ?? 0}ms
                      </p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Requests</p>
                      <p className="font-mono text-lg font-semibold">
                        {selectedWorker.lastRequestCount ?? 0}
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {selectedWorker.status !== "ephemeral" && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground">Worker Info</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {selectedWorker.status !== "offline" && (
                      <div className="rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Uptime</p>
                        <p className="font-mono text-lg font-semibold">
                          {formatUptime(selectedWorker.uptime)}
                        </p>
                      </div>
                    )}
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Status</p>
                      <p className="text-lg font-semibold capitalize">{selectedWorker.status}</p>
                    </div>
                  </div>
                </div>
              )}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground">Statistics</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Total Requests</p>
                    <p className="font-mono text-lg font-semibold">{selectedWorker.requests}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Errors</p>
                    <p
                      className={`font-mono text-lg font-semibold ${selectedWorker.errors > 0 ? "text-destructive" : ""}`}
                    >
                      {selectedWorker.errors}
                    </p>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground">Response Times</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Total Time</p>
                    <p className="font-mono text-lg font-semibold">
                      {(selectedWorker.totalResponseTimeMs / 1000).toFixed(2)}s
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Avg per Request</p>
                    <p className="font-mono text-lg font-semibold">
                      {selectedWorker.avgResponseTimeMs.toFixed(2)}ms
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
          <DrawerFooter>
            <DrawerClose asChild>
              <button
                className="inline-flex h-9 items-center justify-center rounded-md border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted"
                type="button"
              >
                Close
              </button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}
