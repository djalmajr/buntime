import { createFileRoute } from "@tanstack/react-router";
import { DatabaseStudio } from "./-components/database-studio";

export const Route = createFileRoute("/studio")({
  component: DatabaseStudio,
});
