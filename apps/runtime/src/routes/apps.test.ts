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

async function createAppVersion(
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
    await createAppVersion(builtInDir, "builtin-app", "1.0.0", "@buntime/builtin-app");
    await createAppVersion(uploadDir, "uploaded-app", "1.0.0", "@acme/uploaded-app");

    const response = await createTestApp().request("/apps");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "@buntime/builtin-app",
          removable: false,
          source: "built-in",
        }),
        expect.objectContaining({
          name: "@acme/uploaded-app",
          removable: true,
          source: "uploaded",
        }),
      ]),
    );
  });

  it("should ignore apps without package metadata", async () => {
    await mkdir(join(builtInDir, "invalid-app", "1.0.0"), { recursive: true });
    await writeFile(join(builtInDir, "invalid-app", "1.0.0", "index.ts"), "export default {};");
    await createAppVersion(uploadDir, "valid-app", "1.0.0", "@acme/valid-app");

    const response = await createTestApp().request("/apps");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([expect.objectContaining({ name: "@acme/valid-app" })]);
  });

  it("should reject built-in app removal", async () => {
    await createAppVersion(builtInDir, "builtin-app", "1.0.0", "@buntime/builtin-app");

    const response = await createTestApp().request("/apps/%40buntime/builtin-app", {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "BUILT_IN_APP_REMOVE_FORBIDDEN" });
    expect(await Bun.file(join(builtInDir, "builtin-app", "1.0.0", "package.json")).exists()).toBe(
      true,
    );
  });

  it("should remove uploaded apps", async () => {
    await createAppVersion(uploadDir, "uploaded-app", "1.0.0", "@acme/uploaded-app");

    const response = await createTestApp().request("/apps/%40acme/uploaded-app", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(await Bun.file(join(uploadDir, "uploaded-app", "1.0.0", "package.json")).exists()).toBe(
      false,
    );
  });

  it("should reject built-in app version removal", async () => {
    await createAppVersion(builtInDir, "builtin-app", "1.0.0", "@buntime/builtin-app");

    const response = await createTestApp().request("/apps/%40buntime/builtin-app/1.0.0", {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "BUILT_IN_APP_VERSION_REMOVE_FORBIDDEN",
    });
  });
});
