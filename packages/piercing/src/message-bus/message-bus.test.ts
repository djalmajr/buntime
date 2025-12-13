import { describe, expect, it, mock } from "bun:test";
import { GenericMessageBus } from "./message-bus";

describe("GenericMessageBus", () => {
  describe("state", () => {
    it("should return empty state by default", () => {
      const bus = new GenericMessageBus();
      expect(bus.state).toEqual({});
    });

    it("should initialize with provided state", () => {
      const initialState = { foo: "bar", count: 42 };
      const bus = new GenericMessageBus(initialState);
      expect(bus.state).toEqual(initialState);
    });

    it("should return a copy of state (not mutable)", () => {
      const bus = new GenericMessageBus({ foo: "bar" });
      const state1 = bus.state;
      const state2 = bus.state;
      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe("dispatch", () => {
    it("should update state when dispatching", () => {
      const bus = new GenericMessageBus();
      bus.dispatch("test", "value");
      expect(bus.state.test).toBe("value");
    });

    it("should handle different value types", () => {
      const bus = new GenericMessageBus();

      bus.dispatch("string", "hello");
      bus.dispatch("number", 123);
      bus.dispatch("boolean", true);
      bus.dispatch("null", null);
      bus.dispatch("array", [1, 2, 3]);
      bus.dispatch("object", { nested: "value" });

      expect(bus.state).toEqual({
        array: [1, 2, 3],
        boolean: true,
        null: null,
        number: 123,
        object: { nested: "value" },
        string: "hello",
      });
    });

    it("should call listeners asynchronously", async () => {
      const bus = new GenericMessageBus();
      const callback = mock(() => {});

      bus.listen("test", callback);
      bus.dispatch("test", "value");

      // Callback not called synchronously
      expect(callback).not.toHaveBeenCalled();

      // Wait for microtask
      await Promise.resolve();
      expect(callback).toHaveBeenCalledWith("value");
    });
  });

  describe("listen", () => {
    it("should call callback with latest value if exists", async () => {
      const bus = new GenericMessageBus({ existing: "value" });
      const callback = mock(() => {});

      bus.listen("existing", callback);

      await Promise.resolve();
      expect(callback).toHaveBeenCalledWith("value");
    });

    it("should not call callback if no existing value", async () => {
      const bus = new GenericMessageBus();
      const callback = mock(() => {});

      bus.listen("nonexistent", callback);

      await Promise.resolve();
      expect(callback).not.toHaveBeenCalled();
    });

    it("should return cleanup function", async () => {
      const bus = new GenericMessageBus();
      const callback = mock(() => {});

      const cleanup = bus.listen("test", callback);
      cleanup();

      bus.dispatch("test", "value");
      await Promise.resolve();

      // Callback should not be called after cleanup
      expect(callback).not.toHaveBeenCalled();
    });

    it("should support multiple listeners for same event", async () => {
      const bus = new GenericMessageBus();
      const callback1 = mock(() => {});
      const callback2 = mock(() => {});

      bus.listen("test", callback1);
      bus.listen("test", callback2);
      bus.dispatch("test", "value");

      await Promise.resolve();
      expect(callback1).toHaveBeenCalledWith("value");
      expect(callback2).toHaveBeenCalledWith("value");
    });
  });

  describe("latestValue", () => {
    it("should return undefined for nonexistent event", () => {
      const bus = new GenericMessageBus();
      expect(bus.latestValue("nonexistent")).toBeUndefined();
    });

    it("should return latest dispatched value", () => {
      const bus = new GenericMessageBus();
      bus.dispatch("test", "first");
      bus.dispatch("test", "second");
      expect(bus.latestValue("test")).toBe("second");
    });

    it("should return initial state value", () => {
      const bus = new GenericMessageBus({ initial: "value" });
      expect(bus.latestValue("initial")).toBe("value");
    });
  });
});
