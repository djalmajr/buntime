import { Icon } from "@buntime/shadcn-ui";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { Project } from "~/types";

interface ProjectsGridProps {
  projects: Project[];
}

const DEFAULT_ICON = "lucide:book-open";

export function ProjectsGrid({ projects }: ProjectsGridProps) {
  const { t } = useTranslation();

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{t("projects")}</h1>
        <p className="text-muted-foreground">{t("projectsDescription")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((project) => (
          <Link
            key={project.name}
            className="bg-card border rounded-lg p-4 text-left hover:border-primary hover:shadow-md transition-all group"
            params={{ project: project.name }}
            to="/$project"
          >
            <div className="flex items-start gap-4 mb-4">
              <div className="text-green-600 dark:text-green-400">
                <Icon className="text-3xl" icon={project.icon || DEFAULT_ICON} />
              </div>
              <h2 className="text-xl font-semibold group-hover:text-primary">{project.title}</h2>
            </div>

            <p className="text-muted-foreground text-sm line-clamp-3">
              {project.description || t("noDescription")}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
