import { createFileRoute } from "@tanstack/react-router";

function DeploymentsPage() {
  return <piercing-fragment-outlet fragment-id="deployments" />;
}

export const Route = createFileRoute("/deployments/")({
  component: DeploymentsPage,
  loader: () => ({ breadcrumb: "common:nav.deployments" }),
});
