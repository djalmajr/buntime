import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The cpanel home is the runtime overview. `plugin-deployments` (or any other
 * plugin) is just one entry in the unified sidebar — not the implicit
 * landing page.
 */
export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    throw redirect({ to: "/overview" });
  },
});
