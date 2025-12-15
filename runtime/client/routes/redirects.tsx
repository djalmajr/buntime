import { createFileRoute } from "@tanstack/react-router";

function RedirectsPage() {
  return <piercing-fragment-outlet fragment-id="proxy" />;
}

export const Route = createFileRoute("/redirects")({
  component: RedirectsPage,
  loader: () => ({ breadcrumb: "common:nav.redirects" }),
});
