import { describe, expect, it } from "bun:test";
import { getBuiltinPlugin } from "./builtin";

describe("builtin plugins", () => {
  describe("getBuiltinPlugin", () => {
    it("should return undefined for unknown plugin", async () => {
      const plugin = await getBuiltinPlugin("@buntime/plugin-unknown");
      expect(plugin).toBeUndefined();
    });

    it("should return undefined for empty string", async () => {
      const plugin = await getBuiltinPlugin("");
      expect(plugin).toBeUndefined();
    });

    it("should return plugin factory for known plugin", async () => {
      const plugin = await getBuiltinPlugin("@buntime/plugin-metrics");
      expect(plugin).toBeDefined();
      expect(typeof plugin).toBe("function");
    });

    it("should return plugin factory for plugin-keyval", async () => {
      const plugin = await getBuiltinPlugin("@buntime/plugin-keyval");
      expect(plugin).toBeDefined();
      expect(typeof plugin).toBe("function");
    });

    it("should return plugin factory for plugin-authn", async () => {
      const plugin = await getBuiltinPlugin("@buntime/plugin-authn");
      expect(plugin).toBeDefined();
      expect(typeof plugin).toBe("function");
    });

    it("should return plugin factory for plugin-authz", async () => {
      const plugin = await getBuiltinPlugin("@buntime/plugin-authz");
      expect(plugin).toBeDefined();
      expect(typeof plugin).toBe("function");
    });

    it("should return plugin factory for plugin-database", async () => {
      const plugin = await getBuiltinPlugin("@buntime/plugin-database");
      expect(plugin).toBeDefined();
      expect(typeof plugin).toBe("function");
    });

    it("should return plugin factory for plugin-gateway", async () => {
      const plugin = await getBuiltinPlugin("@buntime/plugin-gateway");
      expect(plugin).toBeDefined();
      expect(typeof plugin).toBe("function");
    });

    it("should return plugin factory for plugin-proxy", async () => {
      const plugin = await getBuiltinPlugin("@buntime/plugin-proxy");
      expect(plugin).toBeDefined();
      expect(typeof plugin).toBe("function");
    });

    it("should return plugin factory for plugin-durable", async () => {
      const plugin = await getBuiltinPlugin("@buntime/plugin-durable");
      expect(plugin).toBeDefined();
      expect(typeof plugin).toBe("function");
    });

    it("should return plugin factory for plugin-deployments", async () => {
      const plugin = await getBuiltinPlugin("@buntime/plugin-deployments");
      expect(plugin).toBeDefined();
      expect(typeof plugin).toBe("function");
    });
  });
});
