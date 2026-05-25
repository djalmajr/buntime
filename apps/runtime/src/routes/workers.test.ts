import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { errorToResponse } from "@buntime/shared/errors";
import { Hono } from "hono";
import type { ApiKeyPrincipal } from "@/libs/api-keys";
import { createWorkersRoutes } from "./workers";

/**
 * Build a gzipped tarball (npm-pack style: files wrapped in `package/`) from a
 * map of relative path -> content. The upload handler strips the wrapper.
 */
async function makeTgz(files: Record<string, string>): Promise<Blob> {
  const stage = await mkdtemp(join(tmpdir(), "buntime-tgz-"));
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

async function uploadTgz(app: Hono, files: Record<string, string>, filename = "w.tgz") {
  const fd = new FormData();
  fd.append("file", await makeTgz(files), filename);
  return app.request("/workers/upload", { method: "POST", body: fd });
}

let builtInDir = "";
let testDir = "";
let uploadDir = "";

async function createWorkerVersion(
  baseDir: string,
  name: string,
  version: string,
  packageName = name,
): Promise<void> {
  const versionDir = join(baseDir, name, version);
  await mkdir(versionDir, { recursive: true });
  await writeFile(join(versionDir, "package.json"), JSON.stringify({ name: packageName, version }));
}

function createTestApp(): Hono {
  const app = new Hono().route(
    "/workers",
    createWorkersRoutes({ workerDirs: [builtInDir, uploadDir] }),
  );
  app.onError((error) => errorToResponse(error));
  return app;
}

describe("workers routes", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "buntime-workers-routes-"));
    builtInDir = join(testDir, ".apps");
    uploadDir = join(testDir, "apps");
    await mkdir(builtInDir, { recursive: true });
    await mkdir(uploadDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { force: true, recursive: true });
  });

  it("should expose worker source and removability", async () => {
    await createWorkerVersion(builtInDir, "builtin-worker", "1.0.0", "@buntime/builtin-worker");
    await createWorkerVersion(uploadDir, "uploaded-worker", "1.0.0", "@acme/uploaded-worker");

    const response = await createTestApp().request("/workers");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "@buntime/builtin-worker",
          removable: false,
          source: "built-in",
        }),
        expect.objectContaining({
          name: "@acme/uploaded-worker",
          removable: true,
          source: "uploaded",
        }),
      ]),
    );
  });

  it("should ignore workers without package metadata", async () => {
    await mkdir(join(builtInDir, "invalid-worker", "1.0.0"), { recursive: true });
    await writeFile(join(builtInDir, "invalid-worker", "1.0.0", "index.ts"), "export default {};");
    await createWorkerVersion(uploadDir, "valid-worker", "1.0.0", "@acme/valid-worker");

    const response = await createTestApp().request("/workers");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({ name: "@acme/valid-worker" }),
    ]);
  });

  it("should reject built-in worker removal", async () => {
    await createWorkerVersion(builtInDir, "builtin-worker", "1.0.0", "@buntime/builtin-worker");

    const response = await createTestApp().request("/workers/%40buntime/builtin-worker", {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "BUILT_IN_WORKER_REMOVE_FORBIDDEN" });
    expect(
      await Bun.file(join(builtInDir, "builtin-worker", "1.0.0", "package.json")).exists(),
    ).toBe(true);
  });

  it("should remove uploaded workers", async () => {
    await createWorkerVersion(uploadDir, "uploaded-worker", "1.0.0", "@acme/uploaded-worker");

    const response = await createTestApp().request("/workers/%40acme/uploaded-worker", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(
      await Bun.file(join(uploadDir, "uploaded-worker", "1.0.0", "package.json")).exists(),
    ).toBe(false);
  });

  it("should reject built-in worker version removal", async () => {
    await createWorkerVersion(builtInDir, "builtin-worker", "1.0.0", "@buntime/builtin-worker");

    const response = await createTestApp().request("/workers/%40buntime/builtin-worker/1.0.0", {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "BUILT_IN_WORKER_VERSION_REMOVE_FORBIDDEN",
    });
  });

  describe("upload", () => {
    it("rejects a non-archive file type", async () => {
      const fd = new FormData();
      fd.append("file", new Blob(["x"], { type: "text/plain" }), "worker.txt");
      const res = await createTestApp().request("/workers/upload", { method: "POST", body: fd });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "INVALID_FILE_TYPE" });
    });

    it("installs an unscoped worker at {name}/{version}/", async () => {
      const res = await uploadTgz(createTestApp(), {
        "index.ts": "export default { fetch: () => new Response('ok') };",
        "package.json": JSON.stringify({ name: "hello-app", version: "1.2.3" }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        data: { worker: { name: "hello-app", version: "1.2.3" } },
        success: true,
      });
      expect(await Bun.file(join(uploadDir, "hello-app", "1.2.3", "package.json")).exists()).toBe(
        true,
      );
    });

    it("installs a scoped worker at @scope/{name}/{version}/", async () => {
      const res = await uploadTgz(createTestApp(), {
        "manifest.yaml": 'name: "@acme/api"\nversion: "0.1.0"\n',
        "index.ts": "export default { fetch: () => new Response('ok') };",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        data: { worker: { name: "@acme/api", version: "0.1.0" } },
      });
      expect(await Bun.file(join(uploadDir, "@acme", "api", "0.1.0", "index.ts")).exists()).toBe(
        true,
      );
    });

    it("defaults the version to 'latest' when the manifest omits it", async () => {
      const res = await uploadTgz(createTestApp(), {
        "manifest.yaml": 'name: "no-version-app"\n',
        "index.ts": "export default { fetch: () => new Response('ok') };",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        data: { worker: { name: "no-version-app", version: "latest" } },
      });
      expect(await Bun.file(join(uploadDir, "no-version-app", "latest", "index.ts")).exists()).toBe(
        true,
      );
    });

    it("upserts: re-uploading the same version replaces the folder", async () => {
      const app = createTestApp();
      await uploadTgz(app, {
        "package.json": JSON.stringify({ name: "upsert-app", version: "1.0.0" }),
        "old.txt": "old",
      });
      await uploadTgz(app, {
        "package.json": JSON.stringify({ name: "upsert-app", version: "1.0.0" }),
        "new.txt": "new",
      });
      const dir = join(uploadDir, "upsert-app", "1.0.0");
      expect(await Bun.file(join(dir, "new.txt")).exists()).toBe(true);
      expect(await Bun.file(join(dir, "old.txt")).exists()).toBe(false);
    });
  });

  describe("enable/disable (hot, no restart)", () => {
    it("disables a worker version by writing manifest.enabled=false", async () => {
      await createWorkerVersion(uploadDir, "toggle-app", "1.0.0", "@acme/toggle-app");
      const res = await createTestApp().request("/workers/%40acme/toggle-app/1.0.0/disable", {
        method: "POST",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        data: { enabled: false, name: "@acme/toggle-app", version: "1.0.0" },
        success: true,
      });
      const manifest = await Bun.file(
        join(uploadDir, "toggle-app", "1.0.0", "manifest.yaml"),
      ).text();
      expect(manifest).toContain("enabled: false");
    });

    it("enables a worker version (replaces an existing disabled flag)", async () => {
      const dir = join(uploadDir, "toggle-app", "1.0.0");
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ name: "toggle-app", version: "1.0.0" }),
      );
      await writeFile(join(dir, "manifest.yaml"), 'enabled: false\nttl: "1m"\n');

      const res = await createTestApp().request("/workers/_/toggle-app/1.0.0/enable", {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const manifest = await Bun.file(join(dir, "manifest.yaml")).text();
      expect(manifest).toContain("enabled: true");
      expect(manifest).not.toContain("enabled: false");
      // Unrelated keys preserved.
      expect(manifest).toContain('ttl: "1m"');
    });

    it("returns 404 for an unknown worker version", async () => {
      const res = await createTestApp().request("/workers/_/nope/9.9.9/disable", {
        method: "POST",
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "WORKER_VERSION_NOT_FOUND" });
    });
  });
});

describe("workers namespace scoping", () => {
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
      .route("/workers", createWorkersRoutes({ workerDirs: [nsDir] }));
    app.onError((error) => errorToResponse(error));
    return app;
  }

  beforeEach(async () => {
    nsDir = await mkdtemp(join(tmpdir(), "buntime-workers-ns-"));
    await createWorkerVersion(nsDir, "@acme/checkout", "1.0.0", "@acme/checkout");
    await createWorkerVersion(nsDir, "@team/billing", "1.0.0", "@team/billing");
    await createWorkerVersion(nsDir, "hello-worker", "1.0.0", "hello-worker");
  });

  afterEach(async () => {
    await rm(nsDir, { force: true, recursive: true });
  });

  it("filters GET /workers to the key's namespaces", async () => {
    const res = await appAs(principal(["@acme"])).request("/workers");
    expect(res.status).toBe(200);
    const names = ((await res.json()) as Array<{ name: string }>).map((w) => w.name).sort();
    expect(names).toEqual(["@acme/checkout"]);
  });

  it("'*' key lists every worker", async () => {
    const res = await appAs(principal(["*"])).request("/workers");
    const names = ((await res.json()) as Array<{ name: string }>).map((w) => w.name).sort();
    expect(names).toEqual(["@acme/checkout", "@team/billing", "hello-worker"]);
  });

  it("rejects upload into a forbidden namespace", async () => {
    const res = await uploadTgz(
      appAs(principal(["@acme"])),
      { "package.json": JSON.stringify({ name: "@team/intruder", version: "1.0.0" }) },
      "intruder.tgz",
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "NAMESPACE_DENIED" });
  });

  it("allows upload into the key's own namespace", async () => {
    const res = await uploadTgz(
      appAs(principal(["@acme"])),
      { "package.json": JSON.stringify({ name: "@acme/new-app", version: "1.0.0" }) },
      "new-app.tgz",
    );
    expect(res.status).toBe(200);
  });
});
