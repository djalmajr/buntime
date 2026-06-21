import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RuntimeClient } from "../client.ts";
import { run } from "./helpers.ts";

/** Register API key management tools. */
export function registerKeyTools(server: McpServer, client: RuntimeClient): void {
  server.registerTool(
    "list_keys",
    {
      title: "List API keys",
      description: "List non-revoked API keys. Secrets are never returned, only key prefixes.",
    },
    () => run(() => client.listKeys()),
  );

  server.registerTool(
    "keys_meta",
    {
      title: "API key metadata",
      description: "List supported roles and permission strings for creating keys.",
    },
    () => run(() => client.keysMeta()),
  );

  server.registerTool(
    "create_key",
    {
      title: "Create API key",
      description:
        "Create an API key. The full secret is returned only once. Use role custom with explicit permissions for fine-grained access; namespaces restrict the key to scopes (default ['*']).",
      inputSchema: {
        name: z.string().describe("Display name for the key."),
        role: z
          .enum(["admin", "editor", "viewer", "custom"])
          .optional()
          .describe("Role preset (default editor). Use custom with explicit permissions."),
        permissions: z
          .array(z.string())
          .optional()
          .describe("Explicit permissions (required when role is custom), e.g. workers:install."),
        namespaces: z
          .array(z.string())
          .optional()
          .describe("Namespaces the key may access, e.g. ['@acme']. Default ['*'] (all)."),
        description: z.string().optional().describe("Optional description."),
        expiresIn: z
          .string()
          .optional()
          .describe("Expiration: never (default), 30d, 90d, 1y, or a compact duration like 7d."),
      },
    },
    ({ name, role, permissions, namespaces, description, expiresIn }) =>
      run(() => client.createKey({ name, role, permissions, namespaces, description, expiresIn })),
  );

  server.registerTool(
    "revoke_key",
    {
      title: "Revoke API key",
      description:
        "Revoke an API key by id. The key used for the current request cannot revoke itself.",
      inputSchema: {
        id: z.number().int().describe("API key id (from list_keys)."),
      },
    },
    ({ id }) => run(() => client.revokeKey(id)),
  );
}
