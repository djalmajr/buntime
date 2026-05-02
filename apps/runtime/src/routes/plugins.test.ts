import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errorToResponse } from "@buntime/shared/errors";
import { Hono } from "hono";
import { PluginLoader } from "@/plugins/loader";
import { PluginRegistry } from "@/plugins/registry";
import { createPluginsRoutes } from "./plugins";

let builtInDir = "";
let testDir = "";
let uploadDir = "";

async function createPlugin(baseDir: string, name: string): Promise<void> {
  await mkdir(join(baseDir, name), { recursive: true });
}

function createTestApp(): Hono {
  const app = new Hono().route(
    "/plugins",
    createPluginsRoutes({
      loader: new PluginLoader({ pluginDirs: [] }),
      pluginDirs: [builtInDir, uploadDir],
      registry: new PluginRegistry(),
    }),
  );
  app.onError((error) => errorToResponse(error));
  return app;
}

describe("plugins routes", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "buntime-plugins-routes-"));
    builtInDir = join(testDir, ".plugins");
    uploadDir = join(testDir, "plugins");
    await mkdir(builtInDir, { recursive: true });
    await mkdir(uploadDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { force: true, recursive: true });
  });

  it("should expose plugin source and removability", async () => {
    await createPlugin(builtInDir, "plugin-builtin");
    await createPlugin(uploadDir, "plugin-uploaded");

    const response = await createTestApp().request("/plugins");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "plugin-builtin",
          removable: false,
          source: "built-in",
        }),
        expect.objectContaining({
          name: "plugin-uploaded",
          removable: true,
          source: "uploaded",
        }),
      ]),
    );
  });

  it("should reject built-in plugin removal", async () => {
    await createPlugin(builtInDir, "plugin-builtin");

    const response = await createTestApp().request("/plugins/plugin-builtin", {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "BUILT_IN_PLUGIN_REMOVE_FORBIDDEN" });
    expect(await readdir(join(builtInDir, "plugin-builtin"))).toEqual([]);
  });

  it("should remove uploaded plugins", async () => {
    await createPlugin(uploadDir, "plugin-uploaded");

    const response = await createTestApp().request("/plugins/plugin-uploaded", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    await expect(readdir(join(uploadDir, "plugin-uploaded"))).rejects.toThrow();
  });
});
