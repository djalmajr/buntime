import { createFileRoute } from "@tanstack/react-router";
import { EntriesView } from "./-components/entries-view";

export const Route = createFileRoute("/entries")({
  component: EntriesView,
});
