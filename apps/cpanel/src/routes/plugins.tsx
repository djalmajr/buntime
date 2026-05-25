import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PluginsTab } from "~/components/admin/tabs/plugins";

interface PluginsSearch {
  path?: string;
}

export const Route = createFileRoute("/plugins")({
  component: PluginsRoute,
  loader: () => ({ breadcrumb: "nav.plugins" }),
  validateSearch: (search: Record<string, unknown>): PluginsSearch => ({
    path: typeof search.path === "string" ? search.path : undefined,
  }),
});

function PluginsRoute() {
  // See workers.tsx for `uploadOpen` rationale.
  const [uploadOpen, setUploadOpen] = useState(false);
  return <PluginsTab onUploadOpenChange={setUploadOpen} uploadOpen={uploadOpen} />;
}
