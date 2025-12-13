import { createFileRoute } from "@tanstack/react-router";

function HealthPage() {
  return <piercing-fragment-outlet fragment-id="health" />;
}

export const Route = createFileRoute("/health/")({
  component: HealthPage,
  loader: () => ({ breadcrumb: "common:nav.health" }),
});
