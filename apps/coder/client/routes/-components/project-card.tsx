import { Link } from "@tanstack/react-router";
import { Icon } from "~/components/icon";
import { Button } from "~/components/ui/button";
import type { Project } from "~/hooks/use-projects";
import { TemplateIcon } from "./template-icon";

interface ProjectCardProps {
  project: Project;
  onDelete: (id: string) => void;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  return (
    <div className="bg-card group relative flex flex-col rounded-lg border p-4 transition-colors hover:border-zinc-500">
      <Link
        className="flex flex-1 flex-col"
        params={{ projectId: project.id }}
        to="/projects/$projectId"
      >
        <div className="mb-3 flex items-center gap-3">
          <div className="bg-muted flex size-10 items-center justify-center rounded-lg">
            <TemplateIcon className="text-primary size-5" template={project.template} />
          </div>
          <div className="flex-1 overflow-hidden">
            <h3 className="text-foreground truncate font-medium">{project.name}</h3>
            <p className="text-muted-foreground text-xs">{project.template}</p>
          </div>
        </div>

        <div className="text-muted-foreground mt-auto flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1">
            <Icon className="size-3" name="lucide:file" />
            {project.files.length} {project.files.length === 1 ? "file" : "files"}
          </span>
          <span className="flex items-center gap-1">
            <Icon className="size-3" name="lucide:calendar" />
            {formatDate(project.updatedAt)}
          </span>
        </div>
      </Link>

      <Button
        className="absolute right-2 top-2 size-8 opacity-0 transition-opacity group-hover:opacity-100"
        size="icon"
        variant="ghost"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDelete(project.id);
        }}
      >
        <Icon className="size-4 text-red-400" name="lucide:trash-2" />
      </Button>
    </div>
  );
}
