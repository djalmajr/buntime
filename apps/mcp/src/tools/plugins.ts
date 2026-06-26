import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RuntimeClient } from "../client.ts";
import { resolveArchive } from "../pack.ts";
import { run } from "./helpers.ts";

/** Register plugin management tools. */
export function registerPluginTools(server: McpServer, client: RuntimeClient): void {
  server.registerTool(
    "list_plugins",
    {
      title: "List plugins",
      description:
        "List plugins detected on disk: name, source (built-in/uploaded), and whether removable.",
    },
    () => run(() => client.listPlugins()),
  );

  server.registerTool(
    "list_loaded_plugins",
    {
      title: "List loaded plugins",
      description:
        "List plugins currently active in the registry, with their mount base and dependencies.",
    },
    () => run(() => client.listLoadedPlugins()),
  );

  server.registerTool(
    "upload_plugin",
    {
      title: "Upload plugin",
      description:
        "Upload a plugin. `path` is a local .tgz/.tar.gz/.zip archive or a plugin directory packed automatically. Run reload_plugins afterwards to activate routes without a restart.",
      inputSchema: {
        path: z
          .string()
          .describe(
            "Local path to a plugin archive (.tgz/.tar.gz/.zip) or a plugin directory to pack.",
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
          return await client.uploadPlugin(archivePath);
        } finally {
          await cleanup?.();
        }
      }),
  );

  server.registerTool(
    "reload_plugins",
    {
      title: "Reload plugins",
      description:
        "Rescan plugin directories and hot-reload the registry and live routes (no restart).",
    },
    () => run(() => client.reloadPlugins()),
  );

  const nameTarget = {
    name: z.string().describe("Full plugin name, e.g. @scope/plugin-x (encoded automatically)."),
  };

  server.registerTool(
    "enable_plugin",
    {
      title: "Enable plugin",
      description: "Enable a plugin at runtime (rescans and refreshes routes).",
      inputSchema: nameTarget,
    },
    ({ name }) => run(() => client.setPluginEnabled(name, true)),
  );

  server.registerTool(
    "disable_plugin",
    {
      title: "Disable plugin",
      description: "Disable a plugin at runtime (rescans and refreshes routes).",
      inputSchema: nameTarget,
    },
    ({ name }) => run(() => client.setPluginEnabled(name, false)),
  );

  server.registerTool(
    "delete_plugin",
    {
      title: "Delete plugin",
      description: "Delete an uploaded plugin. Built-in plugins cannot be removed.",
      inputSchema: nameTarget,
    },
    ({ name }) => run(() => client.deletePlugin(name)),
  );
}
