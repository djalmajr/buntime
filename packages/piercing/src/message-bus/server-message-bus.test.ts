import { describe, expect, it } from "bun:test";
import { MESSAGE_BUS_STATE_HEADER, ServerMessageBus } from "./server-message-bus";

describe("ServerMessageBus", () => {
  describe("serialize", () => {
    it("should serialize state to JSON", () => {
      const bus = new ServerMessageBus({ foo: "bar", count: 42 });
      const serialized = bus.serialize();
      expect(JSON.parse(serialized)).toEqual({ foo: "bar", count: 42 });
    });

    it("should serialize empty state", () => {
      const bus = new ServerMessageBus();
      expect(bus.serialize()).toBe("{}");
    });
  });

  describe("fromRequest", () => {
    it("should create bus from request header", () => {
      const state = { user: "test", theme: "dark" };
      const request = new Request("http://localhost", {
        headers: {
          [MESSAGE_BUS_STATE_HEADER]: JSON.stringify(state),
        },
      });

      const bus = ServerMessageBus.fromRequest(request);
      expect(bus.state).toEqual(state);
    });

    it("should return empty bus if no header", () => {
      const request = new Request("http://localhost");
      const bus = ServerMessageBus.fromRequest(request);
      expect(bus.state).toEqual({});
    });

    it("should return empty bus if invalid JSON in header", () => {
      const request = new Request("http://localhost", {
        headers: {
          [MESSAGE_BUS_STATE_HEADER]: "invalid json",
        },
      });

      const bus = ServerMessageBus.fromRequest(request);
      expect(bus.state).toEqual({});
    });
  });

  describe("toRequest", () => {
    it("should add state header to request", () => {
      const bus = new ServerMessageBus({ foo: "bar" });
      const originalRequest = new Request("http://localhost");

      const newRequest = bus.toRequest(originalRequest);

      const header = newRequest.headers.get(MESSAGE_BUS_STATE_HEADER);
      expect(header).not.toBeNull();
      expect(JSON.parse(header!)).toEqual({ foo: "bar" });
    });

    it("should preserve original request properties", () => {
      const bus = new ServerMessageBus();
      const originalRequest = new Request("http://localhost/path?query=1", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const newRequest = bus.toRequest(originalRequest);

      expect(newRequest.method).toBe("POST");
      expect(newRequest.headers.get("Content-Type")).toBe("application/json");
      expect(new URL(newRequest.url).pathname).toBe("/path");
    });
  });

  describe("dispatch and listen", () => {
    it("should update serialized state after dispatch", () => {
      const bus = new ServerMessageBus();
      bus.dispatch("event", "value");

      const serialized = bus.serialize();
      expect(JSON.parse(serialized)).toEqual({ event: "value" });
    });
  });
});
