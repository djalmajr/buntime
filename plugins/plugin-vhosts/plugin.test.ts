import { describe, expect, it, mock } from "bun:test";
import type { PluginContext } from "@buntime/shared/types";
import vhostsPlugin, { type VHostsPluginConfig } from "./plugin";

describe("vhostsPlugin", () => {
  describe("plugin structure", () => {
    it("should have implementation properties", () => {
      const config: VHostsPluginConfig = {
        hosts: { "sked.ly": { app: "skedly@latest" } },
      };
      const plugin = vhostsPlugin(config);

      expect(plugin.server).toBeDefined();
      expect(plugin.server?.fetch).toBeDefined();
      expect(typeof plugin.server?.fetch).toBe("function");
      expect(plugin.onInit).toBeDefined();
      expect(typeof plugin.onInit).toBe("function");
    });

    it("should not have routes (API-less plugin)", () => {
      const config: VHostsPluginConfig = {
        hosts: { "sked.ly": { app: "skedly@latest" } },
      };
      const plugin = vhostsPlugin(config);

      expect(plugin.routes).toBeUndefined();
    });
  });

  describe("config validation", () => {
    it("should accept single host config", () => {
      const config: VHostsPluginConfig = {
        hosts: {
          "sked.ly": { app: "skedly@latest" },
        },
      };
      const plugin = vhostsPlugin(config);

      expect(plugin).toBeDefined();
    });

    it("should accept multiple hosts", () => {
      const config: VHostsPluginConfig = {
        hosts: {
          "sked.ly": { app: "skedly@latest" },
          "*.sked.ly": { app: "skedly@latest" },
          "other.com": { app: "other-app" },
        },
      };
      const plugin = vhostsPlugin(config);

      expect(plugin).toBeDefined();
    });

    it("should accept hosts with pathPrefix", () => {
      const config: VHostsPluginConfig = {
        hosts: {
          "api.sked.ly": { app: "skedly@latest", pathPrefix: "/api" },
        },
      };
      const plugin = vhostsPlugin(config);

      expect(plugin).toBeDefined();
    });

    it("should accept empty hosts config", () => {
      const config: VHostsPluginConfig = {
        hosts: {},
      };
      const plugin = vhostsPlugin(config);

      expect(plugin).toBeDefined();
    });
  });

  describe("server.fetch (before onInit)", () => {
    it("should return 404 for any request before initialization", async () => {
      const config: VHostsPluginConfig = {
        hosts: { "sked.ly": { app: "skedly@latest" } },
      };
      const plugin = vhostsPlugin(config);

      // Before onInit, getWorkerDir is undefined, so matching but unresolvable hosts
      // should return 404
      const req = new Request("http://unknown.com/");
      const response = await plugin.server!.fetch!(req);

      expect(response.status).toBe(404);
    });

    it("should return 404 for unmatched hostname", async () => {
      const config: VHostsPluginConfig = {
        hosts: { "sked.ly": { app: "skedly@latest" } },
      };
      const plugin = vhostsPlugin(config);

      const req = new Request("http://other.com/path");
      const response = await plugin.server!.fetch!(req);

      expect(response.status).toBe(404);
    });
  });

  describe("onInit", () => {
    it("should log configured hosts", async () => {
      const config: VHostsPluginConfig = {
        hosts: {
          "sked.ly": { app: "skedly@latest" },
          "*.sked.ly": { app: "skedly@latest" },
        },
      };
      const plugin = vhostsPlugin(config);

      const loggerMock = {
        debug: mock(() => {}),
        error: mock(() => {}),
        info: mock(() => {}),
        warn: mock(() => {}),
      };

      const ctx: PluginContext = {
        config: {},
        getService: mock(() => undefined),
        globalConfig: {
          poolSize: 100,
          workerDirs: ["/tmp/test-workerDirs"],
        },
        logger: loggerMock,
        pool: {
          fetch: mock(() => Promise.resolve(new Response("OK"))),
        },
        registerService: mock(() => {}),
      };

      await plugin.onInit?.(ctx);

      expect(loggerMock.info).toHaveBeenCalledWith("Virtual hosts configured: sked.ly, *.sked.ly");
    });
  });
});
