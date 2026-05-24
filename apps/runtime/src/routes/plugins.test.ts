import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { errorToResponse } from "@buntime/shared/errors";
import { Hono } from "hono";
import type { ApiKeyPrincipal } from "@/libs/api-keys";
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

  describe("enable/disable (hot-reload)", () => {
    async function createManifestPlugin(
      baseDir: string,
      dirName: string,
      manifest: string,
    ): Promise<string> {
      const pluginPath = join(baseDir, dirName);
      await mkdir(pluginPath, { recursive: true });
      await writeFile(join(pluginPath, "manifest.yaml"), manifest);
      return pluginPath;
    }

    function appWithHotReload(): { app: Hono; reloadCount: () => number } {
      let reloads = 0;
      const registry = new PluginRegistry();
      registry.setReloadHandler(() => {
        reloads += 1;
      });
      const app = new Hono().route(
        "/plugins",
        createPluginsRoutes({
          loader: new PluginLoader({ pluginDirs: [builtInDir, uploadDir] }),
          pluginDirs: [builtInDir, uploadDir],
          registry,
        }),
      );
      app.onError((error) => errorToResponse(error));
      return { app, reloadCount: () => reloads };
    }

    it("disables a plugin: sets enabled:false and triggers a server reload", async () => {
      const dir = await createManifestPlugin(
        uploadDir,
        "plugin-toggle",
        '# a comment\nname: "@acme/plugin-toggle"\nbase: "/toggle"\n',
      );
      const { app, reloadCount } = appWithHotReload();

      const res = await app.request("/plugins/%40acme%2Fplugin-toggle/disable", { method: "POST" });

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ data: { enabled: false }, success: true });
      const manifest = await Bun.file(join(dir, "manifest.yaml")).text();
      expect(manifest).toContain("enabled: false");
      // Comment preserved (surgical edit, not YAML round-trip).
      expect(manifest).toContain("# a comment");
      expect(reloadCount()).toBe(1);
    });

    it("enables a previously disabled plugin (replaces the existing line)", async () => {
      const dir = await createManifestPlugin(
        uploadDir,
        "plugin-toggle",
        'name: "@acme/plugin-toggle"\nenabled: false\nbase: "/toggle"\n',
      );
      const { app } = appWithHotReload();

      const res = await app.request("/plugins/%40acme%2Fplugin-toggle/enable", { method: "POST" });

      expect(res.status).toBe(200);
      const manifest = await Bun.file(join(dir, "manifest.yaml")).text();
      expect(manifest).toContain("enabled: true");
      expect(manifest).not.toContain("enabled: false");
    });

    it("returns 404 for an unknown plugin", async () => {
      const { app } = appWithHotReload();
      const res = await app.request("/plugins/%40acme%2Fnope/disable", { method: "POST" });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "PLUGIN_NOT_FOUND" });
    });
  });
});

describe("plugins namespace scoping", () => {
  let nsDir = "";

  function principal(namespaces: string[], isRoot = false): ApiKeyPrincipal {
    return {
      createdAt: 0,
      id: 1,
      isRoot,
      keyPrefix: "btk_test",
      name: "test",
      namespaces,
      permissions: [],
      role: "editor",
    };
  }

  function appAs(p?: ApiKeyPrincipal): Hono {
    const app = new Hono()
      .use("*", async (c, next) => {
        if (p) c.set("principal", p);
        await next();
      })
      .route(
        "/plugins",
        createPluginsRoutes({
          loader: new PluginLoader({ pluginDirs: [] }),
          pluginDirs: [nsDir],
          registry: new PluginRegistry(),
        }),
      );
    app.onError((error) => errorToResponse(error));
    return app;
  }

  async function makeTgz(files: Record<string, string>): Promise<Blob> {
    const stage = await mkdtemp(join(tmpdir(), "buntime-plugin-tgz-"));
    const pkgRoot = join(stage, "package");
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(pkgRoot, rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content);
    }
    const out = join(stage, "pkg.tgz");
    const proc = Bun.spawn(["tar", "-czf", out, "-C", stage, "package"], { stderr: "pipe" });
    await proc.exited;
    const bytes = await Bun.file(out).arrayBuffer();
    await rm(stage, { force: true, recursive: true });
    return new Blob([bytes], { type: "application/gzip" });
  }

  async function upload(app: Hono, packageName: string): Promise<Response> {
    const fd = new FormData();
    fd.append(
      "file",
      await makeTgz({ "package.json": JSON.stringify({ name: packageName }) }),
      "p.tgz",
    );
    return app.request("/plugins/upload", { method: "POST", body: fd });
  }

  beforeEach(async () => {
    nsDir = await mkdtemp(join(tmpdir(), "buntime-plugins-ns-"));
    await createPlugin(nsDir, "@acme/gateway", "@acme/gateway");
    await createPlugin(nsDir, "@team/redirects", "@team/redirects");
    await createPlugin(nsDir, "legacy-plugin", "legacy-plugin");
  });

  afterEach(async () => {
    await rm(nsDir, { force: true, recursive: true });
  });

  it("filters GET /plugins to the key's namespaces", async () => {
    const res = await appAs(principal(["@acme"])).request("/plugins");
    expect(res.status).toBe(200);
    const names = ((await res.json()) as Array<{ name: string }>).map((p) => p.name).sort();
    expect(names).toEqual(["@acme/gateway"]);
  });

  it("rejects plugin upload into a forbidden namespace", async () => {
    const res = await upload(appAs(principal(["@acme"])), "@team/intruder");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "NAMESPACE_DENIED" });
  });

  it("allows plugin upload into the key's own namespace", async () => {
    const res = await upload(appAs(principal(["@acme"])), "@acme/new-plugin");
    expect(res.status).toBe(200);
  });
});
