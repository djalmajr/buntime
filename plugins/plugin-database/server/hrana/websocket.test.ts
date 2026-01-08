import { describe, expect, it, mock } from "bun:test";
import type { PluginLogger } from "@buntime/shared/types";
import type { HranaServer } from "./server";
import {
  handleHranaWebSocketUpgrade,
  initHranaWebSocket,
  isHranaWebSocketRequest,
} from "./websocket";

// Mock logger
function createMockLogger(): PluginLogger {
  return {
    debug: mock(() => {}),
    error: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
  };
}

describe("isHranaWebSocketRequest", () => {
  it("should return true for valid WebSocket upgrade to /database/api/ws", () => {
    const req = new Request("http://localhost:8000/database/api/ws", {
      headers: { upgrade: "websocket" },
    });

    expect(isHranaWebSocketRequest(req, "/database")).toBe(true);
  });

  it("should return false for non-websocket request", () => {
    const req = new Request("http://localhost:8000/database/api/ws");

    expect(isHranaWebSocketRequest(req, "/database")).toBe(false);
  });

  it("should return false for wrong path", () => {
    const req = new Request("http://localhost:8000/other/api/ws", {
      headers: { upgrade: "websocket" },
    });

    expect(isHranaWebSocketRequest(req, "/database")).toBe(false);
  });

  it("should return false for websocket to different endpoint", () => {
    const req = new Request("http://localhost:8000/database/api/pipeline", {
      headers: { upgrade: "websocket" },
    });

    expect(isHranaWebSocketRequest(req, "/database")).toBe(false);
  });

  it("should handle custom base path", () => {
    const req = new Request("http://localhost:8000/custom-db/api/ws", {
      headers: { upgrade: "websocket" },
    });

    expect(isHranaWebSocketRequest(req, "/custom-db")).toBe(true);
    expect(isHranaWebSocketRequest(req, "/database")).toBe(false);
  });

  it("should be case-insensitive for upgrade header", () => {
    const req = new Request("http://localhost:8000/database/api/ws", {
      headers: { upgrade: "WebSocket" },
    });

    expect(isHranaWebSocketRequest(req, "/database")).toBe(true);
  });
});

describe("handleHranaWebSocketUpgrade", () => {
  it("should return 503 when server not set", () => {
    // Server is not set, so upgrade should fail
    const req = new Request("http://localhost:8000/database/api/ws", {
      headers: { upgrade: "websocket" },
    });

    const response = handleHranaWebSocketUpgrade(req);

    expect(response).toBeDefined();
    expect(response?.status).toBe(503);
  });
});

describe("initHranaWebSocket", () => {
  it("should accept logger and hranaServer", () => {
    const logger = createMockLogger();
    const hranaServer = {} as HranaServer;

    // Should not throw
    expect(() => {
      initHranaWebSocket({ hranaServer, logger });
    }).not.toThrow();
  });
});
