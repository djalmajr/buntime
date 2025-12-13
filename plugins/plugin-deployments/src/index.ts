import type { BasePluginConfig, BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { Hono } from "hono";

export interface DeploymentsConfig extends BasePluginConfig {
  /**
   * Directory containing deployable apps
   * @default Uses globalConfig.appsDir from buntime.jsonc
   */
  appsDir?: string;
}

interface DeploymentInfo {
  name: string;
  path: string;
  size: number;
  modified: Date;
  type: "file" | "directory";
}

let appsDir = "./apps";
let logger: PluginContext["logger"] | undefined;

/**
 * List deployments in the apps directory
 */
async function listDeployments(path = ""): Promise<DeploymentInfo[]> {
  const fullPath = `${appsDir}/${path}`.replace(/\/+/g, "/");
  const entries: DeploymentInfo[] = [];

  try {
    const glob = new Bun.Glob("*");
    for await (const entry of glob.scan({ cwd: fullPath, onlyFiles: false })) {
      const entryPath = `${fullPath}/${entry}`;
      const file = Bun.file(entryPath);
      const stat = await file.exists();

      if (stat) {
        entries.push({
          name: entry,
          path: path ? `${path}/${entry}` : entry,
          size: file.size,
          modified: new Date(),
          type: "file",
        });
      } else {
        // It's a directory
        entries.push({
          name: entry,
          path: path ? `${path}/${entry}` : entry,
          size: 0,
          modified: new Date(),
          type: "directory",
        });
      }
    }
  } catch (error) {
    logger?.error(`Error listing deployments: ${error}`);
  }

  return entries.sort((a, b) => {
    // Directories first, then alphabetically
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Render the deployments fragment HTML
 */
async function renderFragment(req: Request): Promise<string> {
  const url = new URL(req.url);
  const path = url.searchParams.get("path") || "";
  const deployments = await listDeployments(path);

  const breadcrumbs = path
    ? path.split("/").map((segment, index, arr) => {
        const href = `/cpanel/deployments?path=${arr.slice(0, index + 1).join("/")}`;
        return `<a href="${href}" class="text-blue-600 hover:underline">${segment}</a>`;
      })
    : [];

  const items = deployments
    .map((d) => {
      const icon = d.type === "directory" ? "folder" : "file";
      const href =
        d.type === "directory"
          ? `/cpanel/deployments?path=${d.path}`
          : `/api/deployments/download?path=${d.path}`;

      return `
        <tr class="border-b hover:bg-gray-50">
          <td class="px-4 py-3 flex items-center gap-2">
            <span class="text-gray-500">${icon === "folder" ? "📁" : "📄"}</span>
            <a href="${href}" class="text-blue-600 hover:underline">${d.name}</a>
          </td>
          <td class="px-4 py-3 text-gray-500">${d.type}</td>
          <td class="px-4 py-3 text-gray-500">${d.size > 0 ? formatBytes(d.size) : "-"}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="p-6">
      <div class="mb-4">
        <h1 class="text-2xl font-bold mb-2">Deployments</h1>
        <nav class="text-sm text-gray-500">
          <a href="/cpanel/deployments" class="text-blue-600 hover:underline">root</a>
          ${breadcrumbs.length > 0 ? " / " + breadcrumbs.join(" / ") : ""}
        </nav>
      </div>

      <div class="bg-white rounded-lg border shadow-sm">
        <table class="w-full">
          <thead class="bg-gray-50 border-b">
            <tr>
              <th class="px-4 py-3 text-left text-sm font-medium text-gray-500">Name</th>
              <th class="px-4 py-3 text-left text-sm font-medium text-gray-500">Type</th>
              <th class="px-4 py-3 text-left text-sm font-medium text-gray-500">Size</th>
            </tr>
          </thead>
          <tbody>
            ${items || '<tr><td colspan="3" class="px-4 py-8 text-center text-gray-500">No deployments found</td></tr>'}
          </tbody>
        </table>
      </div>

      <p class="mt-4 text-sm text-gray-500">
        Fragment rendered by @buntime/plugin-deployments
      </p>
    </div>
  `;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

// API routes
const routes = new Hono()
  .get("/", async (ctx) => {
    const path = ctx.req.query("path") || "";
    const deployments = await listDeployments(path);
    return ctx.json({ deployments, path });
  })
  .get("/download", async (ctx) => {
    const path = ctx.req.query("path");
    if (!path) {
      return ctx.json({ error: "Path required" }, 400);
    }

    const fullPath = `${appsDir}/${path}`.replace(/\/+/g, "/");
    const file = Bun.file(fullPath);

    if (!(await file.exists())) {
      return ctx.json({ error: "File not found" }, 404);
    }

    return new Response(file, {
      headers: {
        "Content-Disposition": `attachment; filename="${path.split("/").pop()}"`,
      },
    });
  });

export type DeploymentsRoutesType = typeof routes;

/**
 * Deployments plugin for Buntime
 *
 * Provides:
 * - Fragment UI for deployments management
 * - API endpoints for listing and downloading deployments
 */
export default function deploymentsPlugin(pluginConfig: DeploymentsConfig = {}): BuntimePlugin {
  return {
    name: "@buntime/plugin-deployments",
    base: pluginConfig.base ?? "/api/plugin-deployments",
    version: "1.0.0",
    routes,

    // Fragment configuration for micro-frontend
    fragment: {
      fragmentId: "deployments",
      prePierceRoutes: ["/cpanel/deployments", "/cpanel/deployments/*"],
      fetchFragment: async (req) => {
        const html = await renderFragment(req);
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
    },

    onInit(ctx: PluginContext) {
      logger = ctx.logger;
      const config = ctx.config as DeploymentsConfig;
      // Use plugin-specific appsDir if provided, otherwise use global config
      appsDir = config.appsDir ?? ctx.globalConfig.appsDir;
      ctx.logger.info(`Deployments plugin initialized (appsDir: ${appsDir})`);
    },
  };
}
