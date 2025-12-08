import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { Icon } from "~/components/icon";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useProjects } from "~/hooks/use-projects";
import type { TemplateId } from "~/libs/templates";
import { NewProjectDialog } from "../-components/new-project-dialog";
import { ProjectCard } from "../-components/project-card";

function ProjectsPage() {
  const navigate = useNavigate();
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const { createProject, deleteProject, projects } = useProjects();

  const handleCreateProject = useCallback(
    (name: string, template: TemplateId) => {
      const project = createProject(name, template);
      navigate({ params: { projectId: project.id }, to: "/projects/$projectId" });
    },
    [createProject, navigate],
  );

  const handleConfirmDelete = useCallback(() => {
    if (projectToDelete) {
      deleteProject(projectToDelete);
      setProjectToDelete(null);
    }
  }, [deleteProject, projectToDelete]);

  const filteredProjects = projects
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return (
    <>
      <div className="flex flex-col gap-6 p-6">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">All Projects</h1>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Icon
                className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2"
                name="lucide:search"
              />
              <Input
                className="w-64 pl-9"
                placeholder="Search projects..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button onClick={() => setShowNewProjectDialog(true)}>
              <Icon name="lucide:plus" />
              New Project
            </Button>
          </div>
        </div>

        {/* Projects Grid or Empty State */}
        {filteredProjects.length === 0 ? (
          projects.length === 0 ? (
            <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
              <div className="bg-muted flex size-20 items-center justify-center rounded-full">
                <Icon className="text-muted-foreground size-10" name="lucide:folder-open" />
              </div>
              <h2 className="text-xl font-semibold">No projects yet</h2>
              <p className="text-muted-foreground max-w-md text-center">
                Create your first project to get started. Choose from React, Vue.js, or start with a
                blank template.
              </p>
              <Button className="mt-2" onClick={() => setShowNewProjectDialog(true)}>
                <Icon name="lucide:plus" />
                Create Your First Project
              </Button>
            </div>
          ) : (
            <div className="flex h-[40vh] flex-col items-center justify-center gap-4">
              <Icon className="text-muted-foreground size-10" name="lucide:search-x" />
              <p className="text-muted-foreground">No projects found matching "{search}"</p>
            </div>
          )
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredProjects.map((project) => (
              <ProjectCard key={project.id} project={project} onDelete={setProjectToDelete} />
            ))}
          </div>
        )}
      </div>

      <NewProjectDialog
        open={showNewProjectDialog}
        onClose={() => setShowNewProjectDialog(false)}
        onCreate={handleCreateProject}
      />

      <AlertDialog open={projectToDelete !== null} onOpenChange={() => setProjectToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this project? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export const Route = createFileRoute("/_dashboard/")({
  component: ProjectsPage,
});
