import { describe, expect, it } from "bun:test";
import {
  APP_NAME_PATTERN,
  BodySizeLimits,
  ContentTypes,
  Headers,
  IS_DEV,
  MessageTypes,
  NODE_ENV,
  PLUGINS_DIR,
  SHUTDOWN_TIMEOUT_MS,
  VERSION,
  WorkerState,
} from "./constants";

describe("constants", () => {
  describe("BodySizeLimits", () => {
    it("should have correct default value (10MB)", () => {
      expect(BodySizeLimits.DEFAULT).toBe(10 * 1024 * 1024);
    });

    it("should have correct max value (100MB)", () => {
      expect(BodySizeLimits.MAX).toBe(100 * 1024 * 1024);
    });

    it("should have max >= default", () => {
      expect(BodySizeLimits.MAX).toBeGreaterThanOrEqual(BodySizeLimits.DEFAULT);
    });
  });

  describe("Headers", () => {
    it("should have all expected headers", () => {
      expect(Headers.BASE).toBe("x-base");
      expect(Headers.FRAGMENT_ROUTE).toBe("x-fragment-route");
      expect(Headers.NOT_FOUND).toBe("x-not-found");
      expect(Headers.REQUEST_ID).toBe("x-request-id");
      expect(Headers.SEC_FETCH_DEST).toBe("sec-fetch-dest");
      expect(Headers.SEC_FETCH_MODE).toBe("sec-fetch-mode");
    });
  });

  describe("MessageTypes", () => {
    it("should have all expected message types", () => {
      expect(MessageTypes.ERROR).toBe("ERROR");
      expect(MessageTypes.IDLE).toBe("IDLE");
      expect(MessageTypes.READY).toBe("READY");
      expect(MessageTypes.REQUEST).toBe("REQUEST");
      expect(MessageTypes.RESPONSE).toBe("RESPONSE");
      expect(MessageTypes.TERMINATE).toBe("TERMINATE");
    });
  });

  describe("ContentTypes", () => {
    it("should have all expected content types", () => {
      expect(ContentTypes.HTML).toBe("text/html");
      expect(ContentTypes.JSON).toBe("application/json");
      expect(ContentTypes.PLAIN).toBe("text/plain");
    });
  });

  describe("WorkerState", () => {
    it("should have all expected worker states", () => {
      expect(WorkerState.ACTIVE).toBe("active");
      expect(WorkerState.EPHEMERAL).toBe("ephemeral");
      expect(WorkerState.IDLE).toBe("idle");
      expect(WorkerState.OFFLINE).toBe("offline");
    });
  });

  describe("APP_NAME_PATTERN", () => {
    it("should extract app name from pathname", () => {
      const match = "/my-app/page".match(APP_NAME_PATTERN);
      expect(match?.[1]).toBe("my-app");
    });

    it("should extract app name with nested paths", () => {
      const match = "/todos-kv/api/items".match(APP_NAME_PATTERN);
      expect(match?.[1]).toBe("todos-kv");
    });

    it("should return null for root path", () => {
      const match = "/".match(APP_NAME_PATTERN);
      expect(match).toBeNull();
    });
  });

  describe("static values", () => {
    it("should have PLUGINS_DIR defined", () => {
      expect(PLUGINS_DIR).toBe("./plugins");
    });

    it("should have SHUTDOWN_TIMEOUT_MS defined", () => {
      expect(SHUTDOWN_TIMEOUT_MS).toBe(30_000);
    });

    it("should have VERSION defined", () => {
      expect(typeof VERSION).toBe("string");
      expect(VERSION.length).toBeGreaterThan(0);
    });

    it("should have NODE_ENV defined", () => {
      expect(["development", "production", "staging", "test"]).toContain(NODE_ENV);
    });

    it("should have IS_DEV as boolean", () => {
      expect(typeof IS_DEV).toBe("boolean");
    });
  });
});
