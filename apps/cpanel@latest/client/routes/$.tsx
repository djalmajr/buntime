import { createFileRoute, notFound } from "@tanstack/react-router";

// Mapeia primeiro segmento do path para breadcrumb i18n key
const BREADCRUMB_MAP: Record<string, string> = {
  authz: "authz:nav.authz",
  deployments: "common:nav.deployments",
  durable: "common:nav.durable",
  gateway: "common:nav.gateway",
  health: "common:nav.health",
  keyval: "common:nav.keyval",
  logs: "common:nav.logs",
  metrics: "common:nav.metrics",
};

function FragmentRouter() {
  const { _splat } = Route.useParams();
  const segment = _splat?.split("/")[0] ?? "";

  if (!BREADCRUMB_MAP[segment]) {
    throw notFound();
  }

  const href = document.querySelector("base")?.getAttribute("href") || "/";

  return <fragment-outlet base={href.replace(/\/$/, "")} src={`/p/${segment}`} />;
}

export const Route = createFileRoute("/$")({
  component: FragmentRouter,
  loader: ({ params }) => {
    const segment = params._splat?.split("/")[0] ?? "";
    return { breadcrumb: BREADCRUMB_MAP[segment] ?? segment };
  },
});
