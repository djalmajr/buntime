import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RuntimeClient } from "../client.ts";
import { registerKeyTools } from "./keys.ts";
import { registerPluginTools } from "./plugins.ts";
import { registerSystemTools } from "./system.ts";
import { registerWorkerTools } from "./workers.ts";

/** Register every Buntime management tool on the MCP server. */
export function registerAllTools(server: McpServer, client: RuntimeClient): void {
  registerSystemTools(server, client);
  registerWorkerTools(server, client);
  registerPluginTools(server, client);
  registerKeyTools(server, client);
}
