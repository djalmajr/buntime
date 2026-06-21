import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RuntimeClient } from "../client.ts";
import { resolveArchive } from "../pack.ts";
import { run } from "./helpers.ts";

/** Register worker (app) management tools. */
export function registerWorkerTools(server: McpServer, client: RuntimeClient): void {
  server.registerTool(
    "list_workers",
    {
      title: "List workers",
      description:
        "List installed workers (apps): name, installed versions, source (built-in/uploaded), and disabled versions.",
    },
    () => run(() => client.listWorkers()),
  );

  server.registerTool(
    "upload_worker",
    {
      title: "Upload worker",
      description:
        "Upload/deploy a worker. `path` is a local .tgz/.tar.gz/.zip archive, or a worker directory packed automatically. The install path is derived from the package name and version in manifest.yaml/package.json.",
      inputSchema: {
        path: z
          .string()
          .describe(
            "Local path to a worker archive (.tgz/.tar.gz/.zip) or a worker directory to pack.",
          ),
        include: z
          .array(z.string())
          .optional()
          .describe(
            "When `path` is a directory, entries to include (default: manifest.yaml, manifest.yml, package.json, dist).",
          ),
      },
    },
    ({ path, include }) =>
      run(async () => {
        const { archivePath, cleanup } = await resolveArchive(path, include);
        try {
          return await client.uploadWorker(archivePath);
        } finally {
          await cleanup?.();
        }
      }),
  );

  const versionTarget = {
    scope: z.string().describe("Namespace scope: @team for scoped workers, or _ for unscoped."),
    name: z.string().describe("Worker name (without the scope segment)."),
    version: z.string().describe("Version, e.g. 1.0.0."),
  };

  server.registerTool(
    "enable_worker",
    {
      title: "Enable worker",
      description: "Enable a worker version at runtime (no restart).",
      inputSchema: versionTarget,
    },
    ({ scope, name, version }) => run(() => client.setWorkerEnabled(scope, name, version, true)),
  );

  server.registerTool(
    "disable_worker",
    {
      title: "Disable worker",
      description: "Disable a worker version (its base path returns 404 until re-enabled).",
      inputSchema: versionTarget,
    },
    ({ scope, name, version }) => run(() => client.setWorkerEnabled(scope, name, version, false)),
  );

  server.registerTool(
    "delete_worker",
    {
      title: "Delete worker",
      description:
        "Delete a worker. Omit `version` to remove all versions. Built-in workers cannot be removed.",
      inputSchema: {
        scope: z.string().describe("Namespace scope: @team or _ for unscoped."),
        name: z.string().describe("Worker name."),
        version: z
          .string()
          .optional()
          .describe("Specific version to delete; omit to delete every version."),
      },
    },
    ({ scope, name, version }) => run(() => client.deleteWorker(scope, name, version)),
  );
}
