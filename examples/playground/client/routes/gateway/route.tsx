import { createFileRoute, Outlet } from "@tanstack/react-router";

function GatewayLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/gateway")({
  component: GatewayLayout,
  loader: () => ({ breadcrumb: "gateway:nav.gateway" }),
});
