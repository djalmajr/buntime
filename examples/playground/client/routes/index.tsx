import { createFileRoute, Navigate } from "@tanstack/react-router";

function IndexPage() {
  return <Navigate to="/keyval" />;
}

export const Route = createFileRoute("/")({
  component: IndexPage,
});
