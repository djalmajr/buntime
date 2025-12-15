import { createFileRoute, notFound } from "@tanstack/react-router";

interface FragmentConfig {
  breadcrumb: string;
  fragmentId: string;
}

// Mapeia primeiro segmento do path para config do fragment
const FRAGMENT_MAP: Record<string, FragmentConfig> = {
  authz: { breadcrumb: "authz:nav.authz", fragmentId: "authz" },
  deployments: { breadcrumb: "common:nav.deployments", fragmentId: "deployments" },
  durable: { breadcrumb: "common:nav.durable", fragmentId: "durable" },
  gateway: { breadcrumb: "common:nav.gateway", fragmentId: "gateway" },
  health: { breadcrumb: "common:nav.health", fragmentId: "health" },
  keyval: { breadcrumb: "common:nav.keyval", fragmentId: "keyval" },
  logs: { breadcrumb: "common:nav.logs", fragmentId: "logs" },
  metrics: { breadcrumb: "common:nav.metrics", fragmentId: "metrics" },
};

function FragmentRouter() {
  const { _splat } = Route.useParams();
  const segment = _splat?.split("/")[0] ?? "";
  const config = FRAGMENT_MAP[segment];

  if (!config) {
    throw notFound();
  }

  return <piercing-fragment-outlet fragment-id={config.fragmentId} />;
}

export const Route = createFileRoute("/$")({
  component: FragmentRouter,
  loader: ({ params }) => {
    const segment = params._splat?.split("/")[0] ?? "";
    const config = FRAGMENT_MAP[segment];
    return { breadcrumb: config?.breadcrumb ?? segment };
  },
});
