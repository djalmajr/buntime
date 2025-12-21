export interface Project {
  description?: string;
  icon?: string;
  languages?: string[];
  name: string;
  title: string;
}

export interface TreeItem {
  children?: TreeItem[];
  name: string;
  path: string;
  slug: string;
  type: "file" | "directory";
}

export interface TreeResponse {
  lang: string;
  tree: TreeItem[];
}

export interface ReleaseInfo {
  date: string;
  name: string;
  slug: string;
  summary: string;
}

export interface ReleasesResponse {
  lang: string;
  releases: ReleaseInfo[];
}
