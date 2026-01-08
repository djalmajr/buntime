import { beforeEach, describe, expect, it } from "bun:test";
import type { BuntimePlugin, FragmentOptions } from "@buntime/shared/types";
import { PluginRegistry } from "@/plugins/registry";
import { createPluginsInfoRoutes } from "./plugins-info";

describe("createPluginsInfoRoutes", () => {
  let registry: PluginRegistry;

  const createMockPlugin = (overrides: Partial<BuntimePlugin> = {}): BuntimePlugin => ({
    name: "test-plugin",
    base: "/test",
    ...overrides,
  });

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  describe("GET /", () => {
    it("should return empty array when no plugins registered", async () => {
      const routes = createPluginsInfoRoutes({ registry });
      const req = new Request("http://localhost/");
      const res = await routes.fetch(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual([]);
    });

    it("should return plugin info for registered plugins", async () => {
      const plugin = createMockPlugin({
        name: "my-plugin",
        base: "/my-plugin",
      });
      registry.register(plugin);

      const routes = createPluginsInfoRoutes({ registry });
      const req = new Request("http://localhost/");
      const res = await routes.fetch(req);

      expect(res.status).toBe(200);
      interface PluginInfo {
        name: string;
        base: string;
        dependencies: string[];
        optionalDependencies: string[];
        fragment: { enabled: boolean };
        menus: unknown[];
      }
      const json = (await res.json()) as PluginInfo[];
      expect(json).toHaveLength(1);
      expect(json[0]).toEqual({
        base: "/my-plugin",
        dependencies: [],
        fragment: { enabled: false },
        menus: [],
        name: "my-plugin",
        optionalDependencies: [],
      });
    });

    it("should include fragment config when enabled", async () => {
      const fragmentConfig: FragmentOptions = {
        origin: "http://localhost:3000",
        preloadStyles: "/styles.css",
        type: "patch",
      };
      const plugin = createMockPlugin({
        name: "fragment-plugin",
        base: "/fragment",
        fragment: fragmentConfig,
      });
      registry.register(plugin);

      const routes = createPluginsInfoRoutes({ registry });
      const req = new Request("http://localhost/");
      const res = await routes.fetch(req);

      const json = (await res.json()) as Array<{ fragment: unknown }>;
      expect(json[0]?.fragment).toEqual({
        enabled: true,
        origin: "http://localhost:3000",
        preloadStyles: "/styles.css",
        type: "patch",
      });
    });

    it("should include dependencies and optional dependencies", async () => {
      const depPlugin = createMockPlugin({ name: "dep-plugin", base: "/dep" });
      const plugin = createMockPlugin({
        name: "main-plugin",
        base: "/main",
        dependencies: ["dep-plugin"],
        optionalDependencies: ["optional-dep"],
      });
      registry.register(depPlugin);
      registry.register(plugin);

      const routes = createPluginsInfoRoutes({ registry });
      const req = new Request("http://localhost/");
      const res = await routes.fetch(req);

      interface PluginInfo {
        name: string;
        dependencies: string[];
        optionalDependencies: string[];
      }
      const json = (await res.json()) as PluginInfo[];
      const mainPlugin = json.find((p) => p.name === "main-plugin");
      expect(mainPlugin?.dependencies).toEqual(["dep-plugin"]);
      expect(mainPlugin?.optionalDependencies).toEqual(["optional-dep"]);
    });

    it("should include menus when defined", async () => {
      const plugin = createMockPlugin({
        name: "menu-plugin",
        base: "/menu",
        menus: [
          { icon: "home", title: "Home", path: "/" },
          { icon: "settings", title: "Settings", path: "/settings" },
        ],
      });
      registry.register(plugin);

      const routes = createPluginsInfoRoutes({ registry });
      const req = new Request("http://localhost/");
      const res = await routes.fetch(req);

      interface PluginInfoWithMenus {
        menus: Array<{ icon: string; title: string; path: string }>;
      }
      const json = (await res.json()) as PluginInfoWithMenus[];
      expect(json[0]?.menus).toHaveLength(2);
      expect(json[0]?.menus[0]).toEqual({ icon: "home", title: "Home", path: "/" });
    });

    it("should return multiple plugins in registration order", async () => {
      const plugin1 = createMockPlugin({ name: "plugin-a", base: "/a" });
      const plugin2 = createMockPlugin({ name: "plugin-b", base: "/b" });
      const plugin3 = createMockPlugin({ name: "plugin-c", base: "/c" });

      registry.register(plugin1);
      registry.register(plugin2);
      registry.register(plugin3);

      const routes = createPluginsInfoRoutes({ registry });
      const req = new Request("http://localhost/");
      const res = await routes.fetch(req);

      interface PluginInfo {
        name: string;
      }
      const json = (await res.json()) as PluginInfo[];
      expect(json).toHaveLength(3);
      expect(json[0]?.name).toBe("plugin-a");
      expect(json[1]?.name).toBe("plugin-b");
      expect(json[2]?.name).toBe("plugin-c");
    });
  });
});
