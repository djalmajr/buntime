export type {
  ProjectTemplate,
  TemplateDependency,
  TemplateFile,
  TemplateId,
} from "./types";

import { blankTemplate } from "./blank";
import { reactTemplate } from "./react";
import type { ProjectTemplate, TemplateId } from "./types";
import { vueTemplate } from "./vue";

export const templates: Record<TemplateId, ProjectTemplate> = {
  blank: blankTemplate,
  react: reactTemplate,
  vue: vueTemplate,
};

export const templateList = Object.values(templates);
