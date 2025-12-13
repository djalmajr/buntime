import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { PoolStats } from "~/hooks/use-pool-stats";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";

interface PoolMetrics {
  avgResponseTimeMs: number;
  requestsPerSecond: number;
}

interface MetricsChartsProps {
  stats: PoolStats;
}

interface DataPoint {
  avgLatencyMs: number;
  requestsPerSecond: number;
  time: string;
}

const MAX_DATA_POINTS = 30;

const requestsChartConfig = {
  requestsPerSecond: {
    color: "hsl(var(--primary))",
    label: "Requests/sec",
  },
} satisfies ChartConfig;

const latencyChartConfig = {
  avgLatencyMs: {
    color: "hsl(var(--destructive))",
    label: "Latency (ms)",
  },
} satisfies ChartConfig;

export function MetricsCharts({ stats }: MetricsChartsProps) {
  const { t } = useTranslation();
  const [history, setHistory] = useState<DataPoint[]>([]);
  const pool = stats.pool as unknown as PoolMetrics;

  useEffect(() => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now
      .getMinutes()
      .toString()
      .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;

    const newPoint: DataPoint = {
      avgLatencyMs: Number(pool.avgResponseTimeMs.toFixed(0)),
      requestsPerSecond: Number(pool.requestsPerSecond.toFixed(2)),
      time: timeStr,
    };

    setHistory((prev) => {
      const updated = [...prev, newPoint];
      if (updated.length > MAX_DATA_POINTS) {
        return updated.slice(updated.length - MAX_DATA_POINTS);
      }
      return updated;
    });
  }, [stats]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.charts.requestsPerSecond")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer className="h-[300px] w-full" config={requestsChartConfig}>
            <LineChart data={history} margin={{ left: 12, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="time"
                minTickGap={32}
                tickLine={false}
                tickMargin={8}
              />
              <YAxis axisLine={false} tickLine={false} tickMargin={8} />
              <ChartTooltip content={<ChartTooltipContent />} cursor={false} />
              <Line
                dataKey="requestsPerSecond"
                dot={false}
                stroke="var(--color-requestsPerSecond)"
                strokeWidth={2}
                type="monotone"
              />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.charts.latency")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer className="h-[300px] w-full" config={latencyChartConfig}>
            <LineChart data={history} margin={{ left: 12, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="time"
                minTickGap={32}
                tickLine={false}
                tickMargin={8}
              />
              <YAxis axisLine={false} tickLine={false} tickMargin={8} />
              <ChartTooltip content={<ChartTooltipContent />} cursor={false} />
              <Line
                dataKey="avgLatencyMs"
                dot={false}
                stroke="var(--color-avgLatencyMs)"
                strokeWidth={2}
                type="monotone"
              />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
