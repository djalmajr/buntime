import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
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

async function createPlugin(baseDir: string, name: string, packageName?: string): Promise<void> {
  const pluginPath = join(baseDir, name);
  await mkdir(pluginPath, { recursive: true });

  if (packageName) {
    await writeFile(join(pluginPath, "package.json"), JSON.stringify({ name: packageName }));
  }
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
    await createPlugin(builtInDir, "plugin-builtin", "@buntime/plugin-builtin");
    await createPlugin(uploadDir, "plugin-uploaded", "@acme/plugin-uploaded");

    const response = await createTestApp().request("/plugins");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "@buntime/plugin-builtin",
          removable: false,
          source: "built-in",
        }),
        expect.objectContaining({
          name: "@acme/plugin-uploaded",
          removable: true,
          source: "uploaded",
        }),
      ]),
    );
  });

  it("should ignore plugins without package metadata", async () => {
    await createPlugin(builtInDir, "plugin-invalid");
    await createPlugin(uploadDir, "plugin-valid", "@acme/plugin-valid");

    const response = await createTestApp().request("/plugins");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({ name: "@acme/plugin-valid" }),
    ]);
  });

  it("should reject built-in plugin removal", async () => {
    await createPlugin(builtInDir, "plugin-builtin", "@buntime/plugin-builtin");

    const response = await createTestApp().request("/plugins/%40buntime%2Fplugin-builtin", {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "BUILT_IN_PLUGIN_REMOVE_FORBIDDEN" });
    expect(await readdir(join(builtInDir, "plugin-builtin"))).toEqual(["package.json"]);
  });

  it("should remove uploaded plugins", async () => {
    await createPlugin(uploadDir, "plugin-uploaded", "@acme/plugin-uploaded");

    const response = await createTestApp().request("/plugins/%40acme%2Fplugin-uploaded", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    await expect(readdir(join(uploadDir, "plugin-uploaded"))).rejects.toThrow();
  });
});
