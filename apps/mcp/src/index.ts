#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RuntimeClient } from "./client.ts";
import { loadConfig } from "./config.ts";
import { registerAllTools } from "./tools/index.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new RuntimeClient(config);

  const server = new McpServer(
    { name: "buntime-mcp", version: "1.0.0" },
    {
      instructions:
        "Manage a Buntime runtime over its REST API: list, upload, enable/disable, and delete workers and plugins; reload plugins; and manage API keys. Every action is authorized server-side by the configured API key's role and namespaces, so some tools may return a permission error depending on the key.",
    },
  );

  registerAllTools(server, client);

  await server.connect(new StdioServerTransport());
  // stdout carries the JSON-RPC stream; diagnostics must go to stderr only.
  process.stderr.write(`[buntime-mcp] connected to ${config.baseUrl}\n`);
}

main().catch((err) => {
  process.stderr.write(
    `[buntime-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
