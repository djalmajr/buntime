import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCronRequest, discoverCronJobs, listWorkerNames } from "./plugin.ts";

describe("buildCronRequest", () => {
  it("targets the endpoint with internal + cron headers, default POST", () => {
    const req = buildCronRequest({ endpoint: "/api/internal/tick", schedule: "* * * * *" });
    expect(req.method).toBe("POST");
    expect(new URL(req.url).pathname).toBe("/api/internal/tick");
    expect(req.headers.get("x-buntime-cron")).toBe("true");
    expect(req.headers.get("x-buntime-internal")).toBe("true");
    expect(req.headers.get("x-base")).toBe("/");
  });

  it("respects a custom method and normalizes a missing leading slash", () => {
    const req = buildCronRequest({ endpoint: "api/reap", method: "GET", schedule: "0 * * * *" });
    expect(req.method).toBe("GET");
    expect(new URL(req.url).pathname).toBe("/api/reap");
  });
});

describe("discovery", () => {
  it("lists worker names and discovers cron jobs from a manifest", async () => {
    const base = await mkdtemp(join(tmpdir(), "cron-plugin-"));
    await mkdir(join(base, "@scope", "app"), { recursive: true });
    await writeFile(
      join(base, "@scope", "app", "manifest.yaml"),
      'entrypoint: dist/index.js\ncron:\n  - { schedule: "*/5 * * * *", endpoint: "/api/internal/tick" }\n',
    );
    await mkdir(join(base, "plain"));
    await writeFile(join(base, "plain", "manifest.yaml"), "entrypoint: dist/index.js\n");

    expect((await listWorkerNames([base])).sort()).toEqual(["@scope/app", "plain"]);

    const jobs = await discoverCronJobs([base]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ endpoint: "/api/internal/tick", workerName: "@scope/app" });
  });
});
