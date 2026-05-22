import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errorToResponse } from "@buntime/shared/errors";
import { Hono } from "hono";
import { createWorkersRoutes } from "./workers";

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
});
