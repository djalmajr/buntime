import { createFileRoute } from "@tanstack/react-router";

function RedirectsPage() {
  const href = document.querySelector("base")?.getAttribute("href") || "/";

  return <fragment-outlet base={href.replace(/\/$/, "")} src="/p/proxy" />;
}

export const Route = createFileRoute("/redirects")({
  component: RedirectsPage,
  loader: () => ({ breadcrumb: "common:nav.redirects" }),
});
