import { createFileRoute } from "@tanstack/react-router";
import { WorkersView } from "../components/workers-view";

export const Route = createFileRoute("/workers")({
  component: WorkersView,
});
