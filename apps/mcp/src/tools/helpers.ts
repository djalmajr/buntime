import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Wrap a successful tool result as pretty-printed text content. */
export function ok(data: unknown): CallToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

/** Wrap a thrown error as an MCP tool error result, surfacing the runtime code. */
export function toError(err: unknown): CallToolResult {
  const e = err as { code?: string; message?: string; status?: number };
  const code = e?.code ?? "MCP_TOOL_ERROR";
  const status = typeof e?.status === "number" ? ` (HTTP ${e.status})` : "";
  const message = e?.message ?? (err instanceof Error ? err.message : String(err));
  return { content: [{ type: "text", text: `Error ${code}${status}: ${message}` }], isError: true };
}

/** Run a tool handler, mapping success to `ok` content and failures to `toError`. */
export async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return toError(err);
  }
}
