import { createFileRoute, Outlet } from "@tanstack/react-router";

function KeyvalLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/keyval")({
  component: KeyvalLayout,
  loader: () => ({ breadcrumb: "keyval:nav.keyval" }),
});
