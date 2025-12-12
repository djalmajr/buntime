import { createFileRoute, Outlet } from "@tanstack/react-router";

function MetricsLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/metrics")({
  component: MetricsLayout,
  loader: () => ({ breadcrumb: "metrics:nav.metrics" }),
});
