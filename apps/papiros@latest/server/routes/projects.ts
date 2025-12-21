import { DEFAULT_LANG, SUPPORTED_LANGS } from "@/constants";
import type { ProjectConfig, ReleaseInfo } from "@/types";
import { parseAsciiDocAttributes, parseFileAttributes } from "@/utils/asciidoc";
import { buildHierarchicalTree, buildSlugMap, readFileContent } from "@/utils/content";
import { getAvailableLanguage, hasLanguage } from "@/utils/language";
import { exists, listDir, readText } from "@/utils/s3";
import { buildSlugPath, formatName } from "@/utils/slug";
import { Hono } from "hono";

/**
 * Load project config from index.adoc front-matter or fallback to project.json
 */
async function loadProjectConfig(projectName: string): Promise<ProjectConfig | null> {
  // Try to load from index.adoc in default language first
  for (const lang of SUPPORTED_LANGS) {
    const indexPath = `${projectName}/${lang}/index.adoc`;
    const content = await readText(indexPath);

    if (content) {
      const attrs = parseAsciiDocAttributes(content);

      return {
        description: attrs.description,
        icon: attrs.icon,
        name: attrs.name || projectName,
        repo: attrs.repo,
        title: attrs.title || formatName(projectName),
      };
    }
  }

  // Fallback to project.json for backwards compatibility
  const configPath = `${projectName}/project.json`;
  const configContent = await readText(configPath);

  if (configContent) {
    try {
      return JSON.parse(configContent);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Get all projects by scanning S3 bucket root
 */
async function getAllProjects(): Promise<ProjectConfig[]> {
  const projects: ProjectConfig[] = [];

  try {
    const entries = await listDir("");

    for (const entry of entries) {
      if (entry.type === "directory") {
        const config = await loadProjectConfig(entry.name);
        if (config) {
          projects.push(config);
        }
      }
    }
  } catch {
    // Content directory doesn't exist
  }

  return projects;
}

const app = new Hono()
  // List all projects
  .get("/", async (ctx) => {
    const projects = await getAllProjects();
    return ctx.json(projects);
  })

  // Get single project info
  .get("/:project", async (ctx) => {
    const { project } = ctx.req.param();
    const projectConfig = await loadProjectConfig(project);

    if (!projectConfig) {
      return ctx.json({
        name: project,
        title: project,
      });
    }

    // Get available languages for this project
    const languages: string[] = [];
    for (const lang of SUPPORTED_LANGS) {
      if (await hasLanguage(project, lang)) {
        languages.push(lang);
      }
    }

    return ctx.json({ ...projectConfig, languages });
  })

  // Get project docs tree (hierarchical structure)
  .get("/:project/tree", async (ctx) => {
    const { project } = ctx.req.param();
    const lang = ctx.req.query("lang") || DEFAULT_LANG;

    // Check if project exists by trying to list its contents
    try {
      const projectEntries = await listDir(project);
      if (projectEntries.length === 0) {
        return ctx.json({ error: "Project not found" }, 404);
      }
    } catch {
      return ctx.json({ error: "Project not found" }, 404);
    }

    // Check if language folder exists
    const availableLang = await getAvailableLanguage(project, lang);
    if (!availableLang) {
      return ctx.json({ error: "No documentation available", lang }, 404);
    }

    // Build hierarchical tree from language folder
    const langDir = `${project}/${availableLang}`;
    const tree = await buildHierarchicalTree(langDir);

    return ctx.json({
      lang: availableLang,
      tree,
    });
  })

  // Get overview (index.adoc) for a project
  .get("/:project/overview", async (ctx) => {
    const { project } = ctx.req.param();
    const lang = ctx.req.query("lang") || DEFAULT_LANG;

    // Find available language
    const availableLang = await getAvailableLanguage(project, lang);
    if (!availableLang) {
      return ctx.json({ error: "No documentation available" }, 404);
    }

    // Try to read index.adoc from language folder
    const indexPath = `${project}/${availableLang}/index.adoc`;
    const result = await readFileContent(indexPath);

    if (!result) {
      return ctx.json({ error: "Overview not found" }, 404);
    }

    return ctx.json({
      html: result.html,
      lang: availableLang,
      modifiedAt: result.modifiedAt,
      path: "index.adoc",
    });
  })

  // Get document by slug (resolves slug to file path)
  .get("/:project/docs/*", async (ctx) => {
    const { project } = ctx.req.param();
    const lang = ctx.req.query("lang") || DEFAULT_LANG;
    // Extract slug from path - handles both /api/projects and /projects prefixes
    const slug = ctx.req.path.replace(/^.*?\/projects\/[^/]+\/docs\//, "");

    // Find available language
    const availableLang = await getAvailableLanguage(project, lang);
    if (!availableLang) {
      return ctx.json({ error: "No documentation available" }, 404);
    }

    // Build tree to get slug map
    const langDir = `${project}/${availableLang}`;
    const tree = await buildHierarchicalTree(langDir);
    const slugMap = buildSlugMap(tree);

    // Resolve slug to file path
    const filePath = slugMap[slug];
    if (!filePath) {
      return ctx.json({ error: "Document not found", slug }, 404);
    }

    // Read and return file content
    const fullPath = `${langDir}/${filePath}`;

    // Read file attributes for front-matter options like :timeline:
    const attrs = await parseFileAttributes(fullPath);
    const result = await readFileContent(fullPath);

    if (!result) {
      return ctx.json({ error: "File not found" }, 404);
    }

    // Build response with optional timeline config
    const response: Record<string, unknown> = {
      html: result.html,
      lang: availableLang,
      modifiedAt: result.modifiedAt,
      path: filePath,
      slug,
    };

    // Include timeline folder if :timeline: attribute is set (check key exists, value may be empty)
    if ("timeline" in attrs) {
      // Use :timeline-folder: if specified, otherwise derive from file path
      response.timelineFolder = attrs["timeline-folder"] || filePath.replace(/\/[^/]+$/, "");
    }

    return ctx.json(response);
  })

  // Get releases from a directory (for timeline display)
  .get("/:project/releases/*", async (ctx) => {
    const { project } = ctx.req.param();
    const lang = ctx.req.query("lang") || DEFAULT_LANG;
    // Extract folder path from URL
    const folderPath = ctx.req.path.replace(/^.*?\/projects\/[^/]+\/releases\/?/, "") || "";

    // Find available language
    const availableLang = await getAvailableLanguage(project, lang);
    if (!availableLang) {
      return ctx.json({ error: "No documentation available" }, 404);
    }

    // Build path to releases folder
    const releasesDir = folderPath
      ? `${project}/${availableLang}/${folderPath}`
      : `${project}/${availableLang}/releases`;

    // Check if folder exists by listing it
    let entries;
    try {
      entries = await listDir(releasesDir);
      if (entries.length === 0) {
        return ctx.json({ error: "Directory not found" }, 404);
      }
    } catch {
      return ctx.json({ error: "Directory not found" }, 404);
    }

    // Read all .adoc files except index.adoc
    const releases: ReleaseInfo[] = [];

    for (const entry of entries) {
      if (entry.type === "file" && entry.name.endsWith(".adoc") && entry.name !== "index.adoc") {
        const filePath = `${releasesDir}/${entry.name}`;
        const attrs = await parseFileAttributes(filePath);

        // Only include if it has release-date attribute
        if (attrs["release-date"]) {
          const relativePath = folderPath
            ? `${folderPath}/${entry.name}`
            : `releases/${entry.name}`;

          releases.push({
            date: attrs["release-date"],
            name: attrs.title || formatName(entry.name),
            slug: attrs.slug
              ? folderPath
                ? `${buildSlugPath(folderPath)}/${attrs.slug}`
                : `releases/${attrs.slug}`
              : buildSlugPath(relativePath),
            summary: attrs["release-summary"] || "",
          });
        }
      }
    }

    // Sort by date descending (newest first)
    releases.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return ctx.json({
      lang: availableLang,
      releases,
    });
  })

  // Get specific file content (legacy, kept for compatibility)
  .get("/:project/files/*", async (ctx) => {
    const { project } = ctx.req.param();
    const lang = ctx.req.query("lang") || DEFAULT_LANG;
    // Extract file path - handles both /api/projects and /projects prefixes
    const filePath = ctx.req.path.replace(/^.*?\/projects\/[^/]+\/files\//, "");

    // Construct full path with language
    const fullPath = `${project}/${lang}/${filePath}`;

    const result = await readFileContent(fullPath);

    if (!result) {
      return ctx.json({ error: "File not found", lang }, 404);
    }

    return ctx.json({
      html: result.html,
      lang,
      modifiedAt: result.modifiedAt,
      path: filePath,
    });
  });

export default app;
