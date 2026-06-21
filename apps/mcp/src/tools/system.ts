import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeClient } from "../client.ts";
import { run } from "./helpers.ts";

/** Register health and identity tools. */
export function registerSystemTools(server: McpServer, client: RuntimeClient): void {
  server.registerTool(
    "health_check",
    {
      title: "Health check",
      description: "Check the runtime health endpoint. Returns ok, status, and version.",
    },
    () => run(() => client.health()),
  );

  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description:
        "Resolve the configured API key's principal: role, permissions, and namespaces (the same probe the cpanel uses).",
    },
    () => run(() => client.whoami()),
  );
}
