export type TemplateId = "blank" | "react" | "vue";

export interface TemplateDependency {
  name: string;
  version: string;
}

export interface TemplateFile {
  content: string;
  path: string;
}

export interface ProjectTemplate {
  dependencies: TemplateDependency[];
  description: string;
  files: TemplateFile[];
  icon: string;
  id: TemplateId;
  name: string;
}
