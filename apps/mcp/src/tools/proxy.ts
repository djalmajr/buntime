import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RuntimeClient } from "../client.ts";
import { run } from "./helpers.ts";

/**
 * Register proxy redirect tools (plugin-proxy admin). Redirect rules forward
 * matching request paths to a backend — e.g. an app-shell's `/api` to its
 * backend. Rules are persisted in the proxy plugin and applied without restart.
 */
export function registerProxyTools(server: McpServer, client: RuntimeClient): void {
  server.registerTool(
    "list_redirects",
    {
      title: "List proxy redirects",
      description: "List proxy redirect rules (pattern -> target), with their ids and order.",
    },
    () => run(() => client.listRedirects()),
  );

  server.registerTool(
    "set_redirect",
    {
      title: "Set proxy redirect",
      description:
        "Create or update a proxy redirect rule that forwards matching request paths to a backend. Pass `id` to update an existing rule; omit it to create. Applied without restart.",
      inputSchema: {
        name: z.string().describe("Human-readable label for the rule."),
        pattern: z
          .string()
          .describe("Regex matched against the request pathname, e.g. ^/api(/.*)?$"),
        target: z.string().describe("Backend base URL, e.g. https://backend.example.com"),
        rewrite: z.string().optional().describe("Path rewrite using capture groups, e.g. /api$1"),
        changeOrigin: z
          .boolean()
          .optional()
          .describe(
            "Rewrite the Host header to the target (usually true for cross-origin backends).",
          ),
        secure: z.boolean().optional().describe("Verify the target's TLS certificate."),
        id: z
          .string()
          .optional()
          .describe("Existing rule id to update; omit to create a new rule."),
      },
    },
    ({ name, pattern, target, rewrite, changeOrigin, secure, id }) =>
      run(() => client.setRedirect({ name, pattern, target, rewrite, changeOrigin, secure, id })),
  );

  server.registerTool(
    "remove_redirect",
    {
      title: "Remove proxy redirect",
      description: "Delete a proxy redirect rule by id.",
      inputSchema: {
        id: z.string().describe("Rule id (from list_redirects)."),
      },
    },
    ({ id }) => run(() => client.removeRedirect(id)),
  );
}
