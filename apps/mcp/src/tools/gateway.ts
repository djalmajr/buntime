import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RuntimeClient } from "../client.ts";
import { run } from "./helpers.ts";

/**
 * Register gateway app-shell management tools: the global/default shell, the
 * per-tenant (per-host) shell routes, and the shell excludes. Updating an
 * app-shell is two steps — upload the worker (upload_worker), then point the
 * gateway at it here (set_shell_dir for the global shell, or set_shell_route
 * for a specific tenant).
 */
export function registerGatewayTools(server: McpServer, client: RuntimeClient): void {
  server.registerTool(
    "get_shell",
    {
      title: "Get app-shell config",
      description: "Get the gateway app-shell config: global shellDir, source, and excludes.",
    },
    () => run(() => client.getShell()),
  );

  server.registerTool(
    "set_shell_dir",
    {
      title: "Set global app-shell dir",
      description:
        "Set the global app-shell directory — the default shell for hosts without a per-tenant route. `dir` is a shell worker install dir (e.g. /data/apps/@scope/shell/1.0.0). Applied without restart.",
      inputSchema: {
        dir: z.string().describe("Shell worker install directory to serve as the global shell."),
      },
    },
    ({ dir }) => run(() => client.setShellDir(dir)),
  );

  server.registerTool(
    "reset_shell_dir",
    {
      title: "Reset global app-shell dir",
      description: "Clear the global shellDir override, reverting to the ConfigMap/env seed.",
    },
    () => run(() => client.resetShellDir()),
  );

  server.registerTool(
    "list_shell_routes",
    {
      title: "List per-tenant app-shell routes",
      description: "List per-host (tenant) app-shell routes: host -> shell worker dir.",
    },
    () => run(() => client.listShellRoutes()),
  );

  server.registerTool(
    "set_shell_route",
    {
      title: "Set per-tenant app-shell route",
      description:
        "Point a tenant host at a shell worker dir, so that host gets its own shell (or a different version). Applied without restart; hosts without a route use the global shell.",
      inputSchema: {
        host: z
          .string()
          .describe("Tenant host: exact (tenant.example.com) or wildcard (*.example.com)."),
        dir: z.string().describe("Shell worker install directory to serve for this host."),
      },
    },
    ({ host, dir }) => run(() => client.setShellRoute(host, dir)),
  );

  server.registerTool(
    "remove_shell_route",
    {
      title: "Remove per-tenant app-shell route",
      description: "Remove a tenant's app-shell route, reverting that host to the global shell.",
      inputSchema: {
        host: z.string().describe("Tenant host to remove the route for."),
      },
    },
    ({ host }) => run(() => client.removeShellRoute(host)),
  );

  server.registerTool(
    "list_shell_excludes",
    {
      title: "List app-shell excludes",
      description: "List app basenames excluded from shell-wrapping (rendered standalone).",
    },
    () => run(() => client.listShellExcludes()),
  );

  server.registerTool(
    "add_shell_exclude",
    {
      title: "Add app-shell exclude",
      description:
        "Exclude an app basename from shell-wrapping so it renders standalone. Use for apps embedded via z-frame or with their own chrome (avoids shell-inside-shell loops).",
      inputSchema: {
        basename: z.string().describe("App basename (first path segment), e.g. todos."),
      },
    },
    ({ basename }) => run(() => client.addShellExclude(basename)),
  );

  server.registerTool(
    "remove_shell_exclude",
    {
      title: "Remove app-shell exclude",
      description:
        "Remove a runtime-added app-shell exclude (env-based excludes cannot be removed).",
      inputSchema: {
        basename: z.string().describe("App basename to stop excluding."),
      },
    },
    ({ basename }) => run(() => client.removeShellExclude(basename)),
  );
}
