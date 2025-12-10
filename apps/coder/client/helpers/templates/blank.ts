import type { ProjectTemplate } from "./types";

const INDEX_CONTENT = `console.log("Hello, World!");

// Start coding here...
`;

export const blankTemplate: ProjectTemplate = {
  dependencies: [],
  description: "Empty project with a simple TypeScript file",
  files: [{ content: INDEX_CONTENT, path: "/index.tsx" }],
  icon: "lucide:file-code",
  id: "blank",
  name: "Blank",
};
