import { createFileRoute, Outlet } from "@tanstack/react-router";

function DurableLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/durable")({
  component: DurableLayout,
  loader: () => ({ breadcrumb: "durable:nav.durable" }),
});
