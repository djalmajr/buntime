import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  ScrollArea,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@buntime/shadcn-ui";
import { useEffect, useState } from "react";
import { Icon } from "~/components/icon";
import { createMetricsSSE, type MetricsSSEData, type WorkerData } from "~/helpers/sse";

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
  const [connected, setConnected] = useState(false);
  const [selectedWorker, setSelectedWorker] = useState<WorkerData | null>(null);
  const [stats, setStats] = useState<MetricsSSEData | null>(null);

  useEffect(() => {
    setConnected(false);
    const es = createMetricsSSE((data) => {
      setStats(data);
      setConnected(true);
    });

    es.addEventListener("open", () => {
      setConnected(true);
    });

    es.addEventListener("error", () => {
      setConnected(false);
    });

    return () => {
      es.close();
      setConnected(false);
    };
  }, []);

  const connectionStatus = connected ? "connected" : "connecting";

  return (
    <>
      <ScrollArea className="h-full">
        <div className="m-4 space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold">Workers</h1>
              <div
                className={`size-3 rounded-full ${connected ? "bg-green-500" : "bg-yellow-500 animate-pulse"}`}
                title={connectionStatus === "connected" ? "Connected" : "Connecting..."}
              />
            </div>
            <p className="text-muted-foreground">Real-time statistics for all workers</p>
          </div>

          {stats && (
            <Card>
              <CardHeader>
                <CardTitle>Worker Statistics</CardTitle>
                <CardDescription>Statistics for each worker in the pool</CardDescription>
              </CardHeader>
              <CardContent>
                {stats.workers.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Worker ID</TableHead>
                        <TableHead>Avg Time</TableHead>
                        <TableHead className="text-right">Requests</TableHead>
                        <TableHead className="text-right">Errors</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.workers.map((worker) => {
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

                        // Remove "apps@" or "plugins@" prefix from worker ID
                        const displayId = worker.id.replace(/^(apps|plugins)@/, "");

                        return (
                          <TableRow
                            key={worker.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => setSelectedWorker(worker)}
                          >
                            <TableCell className="font-mono text-xs">
                              {displayId}
                              <Icon
                                className="ml-1 inline-block size-3 text-muted-foreground"
                                icon="lucide:chevron-right"
                              />
                            </TableCell>
                            <TableCell className="font-mono">
                              {worker.avgResponseTimeMs.toFixed(1)}ms
                            </TableCell>
                            <TableCell className="text-right">{worker.requests}</TableCell>
                            <TableCell className="text-right">
                              {worker.errors > 0 ? (
                                <span className="text-destructive">{worker.errors}</span>
                              ) : (
                                worker.errors
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusVariant[worker.status]}>
                                {statusLabel[worker.status]}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Icon className="mb-2 size-12 text-muted-foreground" icon="lucide:inbox" />
                    <p className="text-sm text-muted-foreground">
                      No workers are currently running
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {!stats && (
            <Card>
              <CardContent className="flex items-center justify-center py-8">
                <Icon
                  className="size-8 animate-spin text-muted-foreground"
                  icon="lucide:loader-2"
                />
              </CardContent>
            </Card>
          )}
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
              {/* Ephemeral-only: Last Session */}
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

              {/* Persistent/Offline: Worker Info */}
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

              {/* Common: Statistics */}
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

              {/* Common: Response Times */}
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
