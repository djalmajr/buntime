import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCronRequest, listInstalledWorkerNames } from "./scheduler.ts";

describe("buildCronRequest", () => {
  it("builds an internal POST to the worker base + endpoint with auth + cron headers", () => {
    const req = buildCronRequest(
      "@hyper/translate",
      { endpoint: "/api/internal/tick", schedule: "* * * * *" },
      "btk_test",
    );
    expect(req.method).toBe("POST");
    expect(new URL(req.url).pathname).toBe("/@hyper/translate/api/internal/tick");
    expect(req.headers.get("x-api-key")).toBe("btk_test");
    expect(req.headers.get("x-buntime-internal")).toBe("true");
    expect(req.headers.get("x-buntime-cron")).toBe("true");
  });

  it("respects a custom method and normalizes a missing leading slash", () => {
    const req = buildCronRequest(
      "todos",
      { endpoint: "api/reap", method: "GET", schedule: "0 * * * *" },
      "k",
    );
    expect(req.method).toBe("GET");
    expect(new URL(req.url).pathname).toBe("/todos/api/reap");
  });
});

describe("listInstalledWorkerNames", () => {
  it("lists plain and @scoped worker names, ignoring missing dirs", async () => {
    const base = await mkdtemp(join(tmpdir(), "cron-workers-"));
    await mkdir(join(base, "todos"));
    await mkdir(join(base, "@hyper", "translate"), { recursive: true });
    const names = await listInstalledWorkerNames([base, join(base, "does-not-exist")]);
    expect(names.sort()).toEqual(["@hyper/translate", "todos"]);
  });
});
