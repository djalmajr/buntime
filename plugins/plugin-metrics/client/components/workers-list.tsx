import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import type { PoolStats } from "~/hooks/use-pool-stats";

interface WorkersListProps {
  stats: PoolStats;
}

type WorkerStatus = "active" | "idle";

interface WorkerData {
  age: number;
  idle: number;
  requestCount: number;
  status: WorkerStatus;
}

const getStatusVariant = (status: WorkerStatus) => {
  const variants = {
    active: "default",
    idle: "secondary",
  } as const;
  return variants[status];
};

export function WorkersList({ stats }: WorkersListProps) {
  const workersMap = stats.workers as unknown as Record<string, WorkerData>;
  const workers = Object.entries(workersMap);

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const getStatusLabel = (status: WorkerStatus) => {
    const labels = {
      active: "Active",
      idle: "Idle",
    } as const;
    return labels[status];
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Workers</CardTitle>
      </CardHeader>
      <CardContent>
        {workers.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No active workers</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Worker Key</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Idle</TableHead>
                <TableHead>Request Count</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workers.map(([key, worker]) => (
                <TableRow key={key}>
                  <TableCell className="font-mono text-xs">{key}</TableCell>
                  <TableCell>{formatDuration(worker.age)}</TableCell>
                  <TableCell>{formatDuration(worker.idle)}</TableCell>
                  <TableCell>{worker.requestCount}</TableCell>
                  <TableCell>
                    <Badge variant={getStatusVariant(worker.status)}>
                      {getStatusLabel(worker.status)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
