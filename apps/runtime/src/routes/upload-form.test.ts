import { describe, expect, it } from "bun:test";
import { errorToResponse } from "@buntime/shared/errors";
import { Hono } from "hono";
import { readUploadFile } from "./upload-form";

function createApp() {
  const app = new Hono();

  app.post("/upload", async (ctx) => {
    const file = await readUploadFile(ctx);

    return ctx.json({
      name: file.name,
      size: file.size,
    });
  });
  app.onError(errorToResponse);

  return app;
}

describe("readUploadFile", () => {
  it("should reject non-multipart uploads", async () => {
    const response = await createApp().request("/upload", {
      body: JSON.stringify({}),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "INVALID_MULTIPART_FORM",
      message: "Expected multipart/form-data upload",
      success: false,
    });
  });

  it("should reject multipart uploads without file field", async () => {
    const body = new FormData();
    body.set("name", "missing-file");

    const response = await createApp().request("/upload", {
      body,
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "NO_FILE_PROVIDED",
      message: "No file provided",
      success: false,
    });
  });

  it("should return the uploaded file", async () => {
    const body = new FormData();
    body.set("file", new File(["ok"], "plugin.zip", { type: "application/zip" }));

    const response = await createApp().request("/upload", {
      body,
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      name: "plugin.zip",
      size: 2,
    });
  });
});
