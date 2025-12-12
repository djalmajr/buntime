import { createFileRoute, Outlet } from "@tanstack/react-router";

function AuthzLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/authz")({
  component: AuthzLayout,
  loader: () => ({ breadcrumb: "authz:nav.authz" }),
});
