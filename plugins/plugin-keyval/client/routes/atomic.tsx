import { createFileRoute } from "@tanstack/react-router";
import { AtomicView } from "./-components/atomic-view";

export const Route = createFileRoute("/atomic")({
  component: AtomicView,
});
