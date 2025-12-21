import { createFileRoute, useParams } from "@tanstack/react-router";
import { DocViewer } from "~/components/doc-viewer";

export const Route = createFileRoute("/$project/")({
  component: ProjectOverview,
});

function ProjectOverview() {
  const { project } = useParams({ from: "/$project/" });

  return <DocViewer file={null} project={project} />;
}
