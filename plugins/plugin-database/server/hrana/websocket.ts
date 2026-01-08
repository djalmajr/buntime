/**
 * HRANA WebSocket Handler
 *
 * Implements WebSocket transport for HRANA protocol.
 * Provides persistent connections for apps with many database queries.
 */

import type { PluginLogger } from "@buntime/shared/types";
import type { Server, ServerWebSocket } from "bun";
import type { HranaServer } from "./server";
import { HranaHeaders, type HranaStreamRequest, type HranaStreamResult } from "./types";

/**
 * WebSocket message format for requests
 */
interface HranaWsRequest {
  request: HranaStreamRequest;
  request_id: number;
}

/**
 * WebSocket message format for responses
 */
interface HranaWsResponse {
  request_id: number;
  response: HranaStreamResult;
}

/**
 * Data attached to each WebSocket connection
 */
export interface HranaWebSocketData {
  /** Adapter type for this connection */
  adapterType?: string;
  /** Baton for session continuity */
  baton: string | null;
  /** Namespace for multi-tenancy */
  namespace?: string;
}

let hranaServer: HranaServer | null = null;
let bunServer: Server<HranaWebSocketData> | null = null;
let logger: PluginLogger | null = null;

/**
 * Initialize the WebSocket handler
 */
export function initHranaWebSocket(params: {
  hranaServer: HranaServer;
  logger: PluginLogger;
}): void {
  hranaServer = params.hranaServer;
  logger = params.logger;
}

/**
 * Set the Bun server instance for WebSocket upgrades
 */
export function setHranaServer(server: Server<HranaWebSocketData>): void {
  bunServer = server;
}

/**
 * Handle WebSocket open event
 */
function handleOpen(_ws: ServerWebSocket<HranaWebSocketData>): void {
  logger?.debug("HRANA WebSocket connection opened");
}

/**
 * Handle WebSocket message event
 */
async function handleMessage(
  ws: ServerWebSocket<HranaWebSocketData>,
  message: string | Buffer,
): Promise<void> {
  if (!hranaServer) {
    ws.send(
      JSON.stringify({
        request_id: 0,
        response: {
          error: { code: "SERVER_ERROR", message: "HRANA server not initialized" },
          type: "error",
        },
      }),
    );
    return;
  }

  try {
    const messageStr = typeof message === "string" ? message : message.toString("utf-8");
    const request = JSON.parse(messageStr) as HranaWsRequest;

    // Execute the request through pipeline
    const pipelineResult = await hranaServer.handlePipeline(
      {
        baton: ws.data.baton,
        requests: [request.request],
      },
      ws.data.adapterType,
      ws.data.namespace,
    );

    // Update baton for session continuity
    ws.data.baton = pipelineResult.baton;

    // Get the first result (we only sent one request)
    const result = pipelineResult.results[0];

    if (result) {
      const response: HranaWsResponse = {
        request_id: request.request_id,
        response: result,
      };
      ws.send(JSON.stringify(response));
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger?.error("HRANA WebSocket message error", { error: errorMessage });

    ws.send(
      JSON.stringify({
        request_id: 0,
        response: {
          error: { code: "PARSE_ERROR", message: errorMessage },
          type: "error",
        },
      }),
    );
  }
}

/**
 * Handle WebSocket close event
 */
function handleClose(_ws: ServerWebSocket<HranaWebSocketData>, code: number, reason: string): void {
  logger?.debug("HRANA WebSocket connection closed", { code, reason });
}

/**
 * WebSocket handler for Bun.serve
 */
export const hranaWebSocketHandler = {
  close: handleClose,
  message: handleMessage,
  open: handleOpen,
};

/**
 * Check if a request is a WebSocket upgrade request for HRANA
 */
export function isHranaWebSocketRequest(req: Request, basePath: string): boolean {
  const url = new URL(req.url);
  const isWebSocket = req.headers.get("upgrade")?.toLowerCase() === "websocket";
  const isHranaPath = url.pathname === `${basePath}/api/ws`;
  return isWebSocket && isHranaPath;
}

/**
 * Handle WebSocket upgrade request
 * Returns Response if upgrade was handled, undefined otherwise
 */
export function handleHranaWebSocketUpgrade(req: Request): Response | undefined {
  if (!bunServer) {
    logger?.error("Bun server not available for WebSocket upgrade");
    return new Response("Server not ready", { status: 503 });
  }

  const adapterType = req.headers.get(HranaHeaders.ADAPTER) ?? undefined;
  const namespace = req.headers.get(HranaHeaders.NAMESPACE) ?? undefined;

  const success = bunServer.upgrade(req, {
    data: {
      adapterType,
      baton: null,
      namespace,
    },
  });

  if (success) {
    // Return 101 Switching Protocols (Bun handles the actual response)
    return new Response(null, { status: 101 });
  }

  return new Response("WebSocket upgrade failed", { status: 500 });
}
