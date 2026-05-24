/**
 * Route tests for `createFsRoutes`. Exercises both surfaces (workers semver
 * policy + plugins permissive policy) against a shared on-disk fixture, so we
 * verify the factory behaves identically under different policies AND that
 * policy-specific behavior (semver upload validation) is enforced where
 * expected.
 *
 * Ported from `plugins/plugin-deployments/server/api.test.ts`; rewritten
 * against the factory shape and shrunk to the core scenarios.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import type { ApiKeyPrincipal } from "@/libs/api-keys";
import { DirInfo } from "@/libs/fs/dir-info";
import { pluginsPathPolicy, workersPathPolicy } from "@/libs/fs/path-policies";
import { createFsRoutes } from "./fs";

const TEST_ROOT = "/tmp/buntime-fs-routes-test";
const WORKERS_DIR = join(TEST_ROOT, "apps");
const PLUGINS_DIR = join(TEST_ROOT, "plugins");

function buildApp(opts: { dirs: string[]; policy: typeof workersPathPolicy }) {
  const router = createFsRoutes({
    pathPolicy: opts.policy,
    resolveDirs: () => opts.dirs,
  });
  // Mount at `/files` so the URLs look realistic (`/files/list?path=...`).
  return new Hono().route("/files", router);
}

async function call(app: Hono, method: string, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = {
    headers: { "Content-Type": "application/json" },
    method,
  };
  if (body !== undefined) {
    if (body instanceof FormData) {
      delete (init.headers as Record<string, string>)["Content-Type"];
      init.body = body;
    } else {
      init.body = JSON.stringify(body);
    }
  }
  return app.fetch(new Request(`http://localhost${path}`, init));
}

beforeAll(async () => {
  await rm(TEST_ROOT, { force: true, recursive: true });
  await mkdir(WORKERS_DIR, { recursive: true });
  await mkdir(PLUGINS_DIR, { recursive: true });
});

afterAll(async () => {
  await rm(TEST_ROOT, { force: true, recursive: true });
});

beforeEach(async () => {
  // Reset both dirs and global excludes between tests.
  await rm(WORKERS_DIR, { force: true, recursive: true });
  await rm(PLUGINS_DIR, { force: true, recursive: true });
  await mkdir(WORKERS_DIR, { recursive: true });
  await mkdir(PLUGINS_DIR, { recursive: true });
  DirInfo.globalExcludes = [".git", "node_modules"];
});

// ===========================================================================
// Listing / mkdir / delete — works identically across both surfaces.
// ===========================================================================

describe.each([
  { dir: WORKERS_DIR, policy: workersPathPolicy, surface: "workers" },
  { dir: PLUGINS_DIR, policy: pluginsPathPolicy, surface: "plugins" },
])("createFsRoutes ($surface surface)", ({ dir, policy }) => {
  const app = buildApp({ dirs: [dir], policy });
  const rootName = "apps" === dir.split("/").pop() ? "apps" : "plugins";

  describe("GET /files/list", () => {
    it("lists the root mounts when path is empty", async () => {
      const res = await call(app, "GET", "/files/list?path=");
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        code?: string;
        data: { entries: Array<{ name: string }>; path: string };
        success: boolean;
      };
      expect(body.success).toBe(true);
      const names = body.data.entries.map((e: { name: string }) => e.name);
      expect(names).toContain(rootName);
    });

    it("lists the contents of a mount root", async () => {
      await mkdir(join(dir, "alpha"), { recursive: true });
      await mkdir(join(dir, "beta"), { recursive: true });

      const res = await call(app, "GET", `/files/list?path=${rootName}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        code?: string;
        data: { entries: Array<{ name: string }>; path: string };
        success: boolean;
      };
      const names = body.data.entries.map((e: { name: string }) => e.name);
      expect(names).toContain("alpha");
      expect(names).toContain("beta");
    });

    it("returns 404 for an unknown root", async () => {
      const res = await call(app, "GET", "/files/list?path=does-not-exist");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /files/mkdir", () => {
    it("creates a directory inside a mount", async () => {
      const res = await call(app, "POST", "/files/mkdir", { path: `${rootName}/new-folder` });
      expect(res.status).toBe(200);
      const stat = await import("node:fs/promises").then((fs) => fs.stat(join(dir, "new-folder")));
      expect(stat.isDirectory()).toBe(true);
    });

    it("rejects mkdir at the root level (mount selector)", async () => {
      const res = await call(app, "POST", "/files/mkdir", { path: "" });
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        code?: string;
        data: { entries: Array<{ name: string }>; path: string };
        success: boolean;
      };
      expect(body.code).toBe("PATH_REQUIRED");
    });
  });

  describe("DELETE /files/delete", () => {
    it("deletes a file or folder", async () => {
      await mkdir(join(dir, "to-delete"), { recursive: true });

      const res = await call(app, "DELETE", "/files/delete", { path: `${rootName}/to-delete` });
      expect(res.status).toBe(200);
    });

    it("rejects deleting the mount root itself", async () => {
      const res = await call(app, "DELETE", "/files/delete", { path: rootName });
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        code?: string;
        data: { entries: Array<{ name: string }>; path: string };
        success: boolean;
      };
      expect(body.code).toBe("CANNOT_DELETE_ROOT");
    });
  });

  describe("POST /files/rename", () => {
    it("renames an entry", async () => {
      await mkdir(join(dir, "old-name"), { recursive: true });

      const res = await call(app, "POST", "/files/rename", {
        newName: "new-name",
        path: `${rootName}/old-name`,
      });
      expect(res.status).toBe(200);
      const stat = await import("node:fs/promises").then((fs) => fs.stat(join(dir, "new-name")));
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe("GET /files/download", () => {
    it("streams a file", async () => {
      await mkdir(join(dir, "downloadable"), { recursive: true });
      await writeFile(join(dir, "downloadable", "hello.txt"), "hi");

      const res = await call(app, "GET", `/files/download?path=${rootName}/downloadable/hello.txt`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toContain("hello.txt");
      expect(await res.text()).toBe("hi");
    });

    it("404s on missing file", async () => {
      const res = await call(app, "GET", `/files/download?path=${rootName}/nope`);
      expect(res.status).toBe(404);
    });
  });
});

// ===========================================================================
// Policy-specific behavior: upload semver enforcement on workers, free-form
// on plugins.
// ===========================================================================

describe("upload policy enforcement", () => {
  it("workers: rejects upload outside a version folder", async () => {
    const app = buildApp({ dirs: [WORKERS_DIR], policy: workersPathPolicy });
    await mkdir(join(WORKERS_DIR, "my-app"), { recursive: true });

    const form = new FormData();
    form.append("path", "apps/my-app");
    form.append("files", new File(["body"], "x.txt"));

    const res = await call(app, "POST", "/files/upload", form);
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      code?: string;
      data: { entries: Array<{ name: string }>; path: string };
      success: boolean;
    };
    expect(body.code).toBe("UPLOAD_TARGET_INVALID");
  });

  it("workers: accepts upload inside a version folder", async () => {
    const app = buildApp({ dirs: [WORKERS_DIR], policy: workersPathPolicy });
    await mkdir(join(WORKERS_DIR, "my-app", "1.0.0"), { recursive: true });

    const form = new FormData();
    form.append("path", "apps/my-app/1.0.0");
    form.append("files", new File(["body"], "x.txt"));

    const res = await call(app, "POST", "/files/upload", form);
    expect(res.status).toBe(200);
  });

  it("plugins: accepts upload at the plugin root", async () => {
    const app = buildApp({ dirs: [PLUGINS_DIR], policy: pluginsPathPolicy });
    await mkdir(join(PLUGINS_DIR, "my-plugin"), { recursive: true });

    const form = new FormData();
    form.append("path", "plugins/my-plugin");
    form.append("files", new File(["body"], "x.txt"));

    const res = await call(app, "POST", "/files/upload", form);
    expect(res.status).toBe(200);
  });

  it("plugins: accepts upload deep inside a plugin", async () => {
    const app = buildApp({ dirs: [PLUGINS_DIR], policy: pluginsPathPolicy });
    await mkdir(join(PLUGINS_DIR, "my-plugin", "dist"), { recursive: true });

    const form = new FormData();
    form.append("path", "plugins/my-plugin/dist");
    form.append("files", new File(["body"], "x.txt"));

    const res = await call(app, "POST", "/files/upload", form);
    expect(res.status).toBe(200);
  });

  it("rejects upload at root level on both surfaces", async () => {
    const workers = buildApp({ dirs: [WORKERS_DIR], policy: workersPathPolicy });
    const plugins = buildApp({ dirs: [PLUGINS_DIR], policy: pluginsPathPolicy });

    for (const app of [workers, plugins]) {
      const form = new FormData();
      form.append("path", "");
      form.append("files", new File(["body"], "x.txt"));
      const res = await call(app, "POST", "/files/upload", form);
      expect(res.status).toBe(400);
    }
  });
});

// ===========================================================================
// Move policy: source must be strictly inside a unit on both surfaces.
// ===========================================================================

describe("move policy enforcement", () => {
  it("workers: rejects moving the version folder itself", async () => {
    const app = buildApp({ dirs: [WORKERS_DIR], policy: workersPathPolicy });
    await mkdir(join(WORKERS_DIR, "my-app", "1.0.0"), { recursive: true });
    await mkdir(join(WORKERS_DIR, "my-app", "2.0.0"), { recursive: true });

    const res = await call(app, "POST", "/files/move", {
      destPath: "apps/my-app/2.0.0",
      path: "apps/my-app/1.0.0",
    });
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain("Cannot move app or version folders");
  });

  it("workers: allows moving a file between version folders within the same app", async () => {
    const app = buildApp({ dirs: [WORKERS_DIR], policy: workersPathPolicy });
    await mkdir(join(WORKERS_DIR, "my-app", "1.0.0"), { recursive: true });
    await mkdir(join(WORKERS_DIR, "my-app", "2.0.0"), { recursive: true });
    await writeFile(join(WORKERS_DIR, "my-app", "1.0.0", "x.txt"), "hi");

    const res = await call(app, "POST", "/files/move", {
      destPath: "apps/my-app/2.0.0",
      path: "apps/my-app/1.0.0/x.txt",
    });
    expect(res.status).toBe(200);
  });

  it("plugins: rejects moving the plugin folder itself", async () => {
    const app = buildApp({ dirs: [PLUGINS_DIR], policy: pluginsPathPolicy });
    await mkdir(join(PLUGINS_DIR, "alpha"), { recursive: true });
    await mkdir(join(PLUGINS_DIR, "beta"), { recursive: true });

    const res = await call(app, "POST", "/files/move", {
      destPath: "plugins/beta",
      path: "plugins/alpha",
    });
    expect(res.status).toBe(500);
  });

  it("plugins: allows moving a file inside a plugin", async () => {
    const app = buildApp({ dirs: [PLUGINS_DIR], policy: pluginsPathPolicy });
    await mkdir(join(PLUGINS_DIR, "alpha", "src"), { recursive: true });
    await mkdir(join(PLUGINS_DIR, "alpha", "dist"), { recursive: true });
    await writeFile(join(PLUGINS_DIR, "alpha", "src", "x.ts"), "//");

    const res = await call(app, "POST", "/files/move", {
      destPath: "plugins/alpha/dist",
      path: "plugins/alpha/src/x.ts",
    });
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// Multi-root: a workerDirs list with both "apps" and "packages" exposes both
// as listable folders at the root level.
// ===========================================================================

describe("multiple mount roots", () => {
  const appsDir = join(TEST_ROOT, "apps");
  const pkgsDir = join(TEST_ROOT, "packages");

  beforeEach(async () => {
    await rm(pkgsDir, { force: true, recursive: true });
    await mkdir(pkgsDir, { recursive: true });
  });

  it("root listing returns both roots", async () => {
    const app = buildApp({ dirs: [appsDir, pkgsDir], policy: workersPathPolicy });
    const res = await call(app, "GET", "/files/list?path=");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      code?: string;
      data: { entries: Array<{ name: string }>; path: string };
      success: boolean;
    };
    const names = body.data.entries.map((e: { name: string }) => e.name);
    expect(names).toContain("apps");
    expect(names).toContain("packages");
  });

  it("rejects cross-root moves", async () => {
    const app = buildApp({ dirs: [appsDir, pkgsDir], policy: workersPathPolicy });
    await mkdir(join(appsDir, "my-app", "1.0.0"), { recursive: true });
    await mkdir(join(pkgsDir, "my-pkg", "1.0.0"), { recursive: true });
    await writeFile(join(appsDir, "my-app", "1.0.0", "x.txt"), "hi");

    const res = await call(app, "POST", "/files/move", {
      destPath: "packages/my-pkg/1.0.0",
      path: "apps/my-app/1.0.0/x.txt",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      code?: string;
      data: { entries: Array<{ name: string }>; path: string };
      success: boolean;
    };
    expect(body.code).toBe("CROSS_DIR_MOVE_NOT_SUPPORTED");
  });
});

// ===========================================================================
// Refresh — invalidate `.dirinfo` caches without rebuilding them inline.
// ===========================================================================

describe("refresh", () => {
  it("GET /files/refresh succeeds at root", async () => {
    const app = buildApp({ dirs: [WORKERS_DIR], policy: workersPathPolicy });
    const res = await call(app, "GET", "/files/refresh?path=");
    expect(res.status).toBe(200);
  });

  it("POST /files/refresh accepts a JSON body", async () => {
    const app = buildApp({ dirs: [WORKERS_DIR], policy: workersPathPolicy });
    await mkdir(join(WORKERS_DIR, "my-app"), { recursive: true });
    const res = await call(app, "POST", "/files/refresh", { path: "apps/my-app" });
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// Namespace-scoped access control — a restricted key may only see/manage its
// own `@namespace` units. Root and `*` keys are unaffected.
// ===========================================================================

describe("namespace access control", () => {
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

  function buildAppAs(p: ApiKeyPrincipal | undefined) {
    const router = createFsRoutes({
      pathPolicy: workersPathPolicy,
      resolveDirs: () => [WORKERS_DIR],
    });
    return new Hono()
      .use("*", async (c, next) => {
        if (p) c.set("principal", p);
        await next();
      })
      .route("/files", router);
  }

  beforeEach(async () => {
    await mkdir(join(WORKERS_DIR, "@acme", "checkout", "1.0.0"), { recursive: true });
    await mkdir(join(WORKERS_DIR, "@team", "billing", "1.0.0"), { recursive: true });
    await mkdir(join(WORKERS_DIR, "hello-worker", "1.0.0"), { recursive: true });
  });

  it("filters mount-level listing to accessible namespaces", async () => {
    const app = buildAppAs(principal(["@acme"]));
    const res = await call(app, "GET", "/files/list?path=apps");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { entries: Array<{ name: string }> } };
    const names = body.data.entries.map((e) => e.name).sort();
    expect(names).toEqual(["@acme"]);
  });

  it("403s when listing into a forbidden namespace", async () => {
    const app = buildAppAs(principal(["@acme"]));
    const res = await call(app, "GET", "/files/list?path=apps/@team");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("NAMESPACE_DENIED");
  });

  it("allows listing into an accessible namespace", async () => {
    const app = buildAppAs(principal(["@acme"]));
    const res = await call(app, "GET", "/files/list?path=apps/@acme");
    expect(res.status).toBe(200);
  });

  it("403s on mkdir into a forbidden namespace", async () => {
    const app = buildAppAs(principal(["@acme"]));
    const res = await call(app, "POST", "/files/mkdir", { path: "apps/@team/x" });
    expect(res.status).toBe(403);
  });

  it("allows mkdir into an accessible namespace", async () => {
    const app = buildAppAs(principal(["@acme"]));
    const res = await call(app, "POST", "/files/mkdir", { path: "apps/@acme/x" });
    expect(res.status).toBe(200);
  });

  it("denies unscoped units unless the key holds '*'", async () => {
    const app = buildAppAs(principal(["@acme"]));
    const res = await call(app, "GET", "/files/list?path=apps/hello-worker");
    expect(res.status).toBe(403);
  });

  it("'*' key sees every namespace and unscoped unit", async () => {
    const app = buildAppAs(principal(["*"]));
    const res = await call(app, "GET", "/files/list?path=apps");
    const body = (await res.json()) as { data: { entries: Array<{ name: string }> } };
    const names = body.data.entries.map((e) => e.name).sort();
    expect(names).toEqual(["@acme", "@team", "hello-worker"]);
  });

  it("root key bypasses all namespace checks", async () => {
    const app = buildAppAs(principal(["@acme"], true));
    const res = await call(app, "GET", "/files/list?path=apps/@team");
    expect(res.status).toBe(200);
  });
});
