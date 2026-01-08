import { useQuery } from "@tanstack/react-query";
import { api } from "~/helpers/api-client";
import type { Project, ReleasesResponse, TreeResponse } from "~/types";

interface DocResponse {
  error?: string;
  html?: string;
  lang?: string;
  modifiedAt?: string;
  path?: string;
  slug?: string;
  timelineFolder?: string;
}

export function useProjects() {
  return useQuery({
    queryFn: async () => {
      const res = await api.projects.$get();
      return res.json() as Promise<Project[]>;
    },
    queryKey: ["projects"],
  });
}

export function useProject(project: string) {
  return useQuery({
    enabled: !!project,
    queryFn: async () => {
      const res = await api.projects[":project"].$get({
        param: { project },
      });
      return res.json() as Promise<Project>;
    },
    queryKey: ["project", project],
  });
}

export function useProjectTree(project: string, lang: string) {
  return useQuery({
    enabled: !!project && !!lang,
    queryFn: async () => {
      const res = await fetch(`api/projects/${project}/tree?lang=${lang}`);
      return res.json() as Promise<TreeResponse>;
    },
    queryKey: ["project-tree", project, lang],
  });
}

export function useProjectOverview(project: string, lang: string) {
  return useQuery({
    enabled: !!project && !!lang,
    queryFn: async () => {
      const res = await fetch(`api/projects/${project}/overview?lang=${lang}`);
      return res.json() as Promise<DocResponse>;
    },
    queryKey: ["project-overview", project, lang],
  });
}

export function useProjectDoc(project: string, slug: string, lang: string) {
  return useQuery({
    enabled: !!project && !!slug && !!lang,
    queryFn: async () => {
      const res = await fetch(`api/projects/${project}/docs/${slug}?lang=${lang}`);
      return res.json() as Promise<DocResponse>;
    },
    queryKey: ["project-doc", project, slug, lang],
  });
}

export function useProjectReleases(project: string, folder: string, lang: string) {
  return useQuery({
    enabled: !!project && !!lang,
    queryFn: async () => {
      const path = folder
        ? `api/projects/${project}/releases/${folder}`
        : `api/projects/${project}/releases/`;
      const res = await fetch(`${path}?lang=${lang}`);
      return res.json() as Promise<ReleasesResponse>;
    },
    queryKey: ["project-releases", project, folder, lang],
  });
}
