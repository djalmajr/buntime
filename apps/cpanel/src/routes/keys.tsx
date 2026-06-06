import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { KeysTab } from "~/components/admin/tabs/keys";

export const Route = createFileRoute("/keys")({
  component: KeysRoute,
  loader: () => ({ breadcrumb: "nav.keys" }),
});

function KeysRoute() {
  // The "New key" action lives in the tab content toolbar (like Workers/Plugins),
  // not in the shell header. `createOpen` drives the create Sheet.
  const [createOpen, setCreateOpen] = useState(false);
  return <KeysTab createOpen={createOpen} onCreateOpenChange={setCreateOpen} />;
}
