import { useCallback, useEffect, useState } from "react";
import { type TemplateId, templates } from "~/libs/templates";

const STORAGE_KEY = "buntime-projects";

export interface Project {
  createdAt: string;
  dependencies: { name: string; version: string }[];
  files: { content: string; path: string }[];
  id: string;
  name: string;
  template: TemplateId;
  updatedAt: string;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function loadProjects(): Project[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveProjects(projects: Project[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);

  // Load projects on mount
  useEffect(() => {
    setProjects(loadProjects());
  }, []);

  const createProject = useCallback((name: string, templateId: TemplateId): Project => {
    const template = templates[templateId];
    const now = new Date().toISOString();

    const newProject: Project = {
      createdAt: now,
      dependencies: [...template.dependencies],
      files: template.files.map((f) => ({ ...f })),
      id: generateId(),
      name,
      template: templateId,
      updatedAt: now,
    };

    setProjects((prev) => {
      const updated = [...prev, newProject];
      saveProjects(updated);
      return updated;
    });

    return newProject;
  }, []);

  const deleteProject = useCallback((id: string): void => {
    setProjects((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      saveProjects(updated);
      return updated;
    });
  }, []);

  const getProject = useCallback(
    (id: string): Project | undefined => {
      return projects.find((p) => p.id === id);
    },
    [projects],
  );

  const updateProject = useCallback((id: string, updates: Partial<Omit<Project, "id">>): void => {
    setProjects((prev) => {
      const updated = prev.map((p) =>
        p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p,
      );
      saveProjects(updated);
      return updated;
    });
  }, []);

  return {
    createProject,
    deleteProject,
    getProject,
    projects,
    updateProject,
  };
}

// Standalone functions for use outside React components
export function getProjectById(id: string): Project | undefined {
  const projects = loadProjects();
  return projects.find((p) => p.id === id);
}

export function updateProjectById(id: string, updates: Partial<Omit<Project, "id">>): void {
  const projects = loadProjects();
  const updated = projects.map((p) =>
    p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p,
  );
  saveProjects(updated);
}
