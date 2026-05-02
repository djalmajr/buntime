import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errorToResponse } from "@buntime/shared/errors";
import { Hono } from "hono";
import { createAppsRoutes } from "./apps";

let builtInDir = "";
let testDir = "";
let uploadDir = "";

async function createAppVersion(baseDir: string, name: string, version: string): Promise<void> {
  const versionDir = join(baseDir, name, version);
  await mkdir(versionDir, { recursive: true });
  await writeFile(join(versionDir, "index.ts"), "export default {};");
}

function createTestApp(): Hono {
  const app = new Hono().route("/apps", createAppsRoutes({ workerDirs: [builtInDir, uploadDir] }));
  app.onError((error) => errorToResponse(error));
  return app;
}

describe("apps routes", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "buntime-apps-routes-"));
    builtInDir = join(testDir, ".apps");
    uploadDir = join(testDir, "apps");
    await mkdir(builtInDir, { recursive: true });
    await mkdir(uploadDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { force: true, recursive: true });
  });

  it("should expose app source and removability", async () => {
    await createAppVersion(builtInDir, "builtin-app", "1.0.0");
    await createAppVersion(uploadDir, "uploaded-app", "1.0.0");

    const response = await createTestApp().request("/apps");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "builtin-app",
          removable: false,
          source: "built-in",
        }),
        expect.objectContaining({
          name: "uploaded-app",
          removable: true,
          source: "uploaded",
        }),
      ]),
    );
  });

  it("should reject built-in app removal", async () => {
    await createAppVersion(builtInDir, "builtin-app", "1.0.0");

    const response = await createTestApp().request("/apps/_/builtin-app", { method: "DELETE" });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "BUILT_IN_APP_REMOVE_FORBIDDEN" });
    expect(await Bun.file(join(builtInDir, "builtin-app", "1.0.0", "index.ts")).exists()).toBe(
      true,
    );
  });

  it("should remove uploaded apps", async () => {
    await createAppVersion(uploadDir, "uploaded-app", "1.0.0");

    const response = await createTestApp().request("/apps/_/uploaded-app", { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(await Bun.file(join(uploadDir, "uploaded-app", "1.0.0", "index.ts")).exists()).toBe(
      false,
    );
  });

  it("should reject built-in app version removal", async () => {
    await createAppVersion(builtInDir, "builtin-app", "1.0.0");

    const response = await createTestApp().request("/apps/_/builtin-app/1.0.0", {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "BUILT_IN_APP_VERSION_REMOVE_FORBIDDEN",
    });
  });
});
