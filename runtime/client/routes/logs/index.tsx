import { createFileRoute } from "@tanstack/react-router";

function LogsPage() {
  return <piercing-fragment-outlet fragment-id="logs" />;
}

export const Route = createFileRoute("/logs/")({
  component: LogsPage,
  loader: () => ({ breadcrumb: "common:nav.logs" }),
});
