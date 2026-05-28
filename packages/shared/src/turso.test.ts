import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ValidationError } from "./errors";
import { openTurso } from "./turso";

const dir = mkdtempSync(join(tmpdir(), "buntime-turso-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("openTurso", () => {
  it("rejects invalid namespaces", async () => {
    await expect(openTurso("bad name!", { dir })).rejects.toBeInstanceOf(ValidationError);
    await expect(openTurso("with/slash", { dir })).rejects.toBeInstanceOf(ValidationError);
  });

  it("opens a local namespaced database and runs SQL", async () => {
    const db = await openTurso("tenants", { dir });
    expect(db.mode).toBe("local");

    await db.exec(
      "CREATE TABLE IF NOT EXISTS tenants (host TEXT PRIMARY KEY, realm TEXT NOT NULL)",
    );
    await db
      .prepare("INSERT INTO tenants (host, realm) VALUES (?, ?)")
      .run("tenant-1.example.com", "tenant-1");

    const row = await db
      .prepare("SELECT realm FROM tenants WHERE host = ?")
      .get<{ realm: string }>("tenant-1.example.com");
    expect(row?.realm).toBe("tenant-1");

    const rows = await db.prepare("SELECT host FROM tenants").all<{ host: string }>();
    expect(rows).toHaveLength(1);

    await db.close();
  });

  it("pull/push are no-ops in local mode", async () => {
    const db = await openTurso("noop", { dir });
    expect(await db.pull()).toBe(false);
    await expect(db.push()).resolves.toBeUndefined();
    await db.close();
  });

  it("persists across reopen (same namespace file)", async () => {
    const a = await openTurso("persist", { dir });
    await a.exec("CREATE TABLE IF NOT EXISTS t (v INTEGER)");
    await a.prepare("INSERT INTO t (v) VALUES (?)").run(42);
    await a.close();

    const b = await openTurso("persist", { dir });
    const row = await b.prepare("SELECT v FROM t").get<{ v: number }>();
    expect(row?.v).toBe(42);
    await b.close();
  });
});
