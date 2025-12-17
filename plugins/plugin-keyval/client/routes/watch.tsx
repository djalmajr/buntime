import { createFileRoute } from "@tanstack/react-router";
import { WatchView } from "./-components/watch-view";

export const Route = createFileRoute("/watch")({
  component: WatchView,
});
