import { createFileRoute } from "@tanstack/react-router";
import { MetricsView } from "./-components/metrics-view";

export const Route = createFileRoute("/metrics")({
  component: MetricsView,
});
