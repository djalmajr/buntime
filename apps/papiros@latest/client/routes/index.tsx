import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ProjectsGrid } from "~/components/projects-grid";
import type { Project } from "~/types";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    fetch("api/projects")
      .then((res) => res.json())
      .then((data) => {
        setProjects(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load projects:", err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <main className="p-4 flex-1">
      <ProjectsGrid projects={projects} />
    </main>
  );
}
