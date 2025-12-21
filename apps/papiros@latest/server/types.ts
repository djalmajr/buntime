export interface ProjectConfig {
  description?: string;
  icon?: string;
  name: string;
  repo?: string;
  title: string;
}

export interface TreeNode {
  children?: TreeNode[];
  name: string;
  path: string;
  slug: string;
  type: "file" | "directory";
}

export interface FileResponse {
  html: string;
  modifiedAt: string;
  path: string;
}

export interface ReleaseInfo {
  date: string;
  name: string;
  slug: string;
  summary: string;
}
