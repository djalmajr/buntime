import { createFileRoute } from "@tanstack/react-router";
import { AdminConsole } from "~/components/admin/admin-console";

function AdminRoute() {
  return <AdminConsole />;
}

export const Route = createFileRoute("/admin")({
  component: AdminRoute,
  loader: () => ({ breadcrumb: "nav.admin" }),
});
