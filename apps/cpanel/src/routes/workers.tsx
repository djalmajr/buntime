import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { WorkersTab } from "~/components/admin/tabs/workers";

interface WorkersSearch {
  path?: string;
}

export const Route = createFileRoute("/workers")({
  component: WorkersRoute,
  loader: () => ({ breadcrumb: "nav.workers" }),
  validateSearch: (search: Record<string, unknown>): WorkersSearch => ({
    path: typeof search.path === "string" ? search.path : undefined,
  }),
});

function WorkersRoute() {
  // `uploadOpen` is preserved for backwards compatibility with the old
  // header upload trigger but is no-op now: upload happens via the
  // FileBrowser toolbar (file/folder picker buttons + drag-drop).
  const [uploadOpen, setUploadOpen] = useState(false);
  return <WorkersTab onUploadOpenChange={setUploadOpen} uploadOpen={uploadOpen} />;
}
