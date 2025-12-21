import { createFileRoute, useParams } from "@tanstack/react-router";
import { DocViewer } from "~/components/doc-viewer";

export const Route = createFileRoute("/$project/$")({
  component: FilePage,
});

function FilePage() {
  const { _splat: file, project } = useParams({ from: "/$project/$" });

  return <DocViewer file={file} project={project} />;
}
