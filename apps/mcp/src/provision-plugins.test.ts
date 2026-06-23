import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePluginSource, verifyLoaded } from "./provision-plugins.ts";

describe("resolvePluginSource", () => {
  it("resolves an existing local path relative to baseDir (skipBuild)", async () => {
    const base = await mkdtemp(join(tmpdir(), "rps-"));
    try {
      // "." resolves to baseDir itself, which exists; skipBuild avoids any build.
      const dir = await resolvePluginSource(".", base, { skipBuild: true });
      expect(dir).toBe(base);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("throws when the local source does not exist", async () => {
    const base = await mkdtemp(join(tmpdir(), "rps-"));
    try {
      await expect(
        resolvePluginSource("./does-not-exist", base, { skipBuild: true }),
      ).rejects.toThrow(/plugin source not found/);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

describe("verifyLoaded", () => {
  const clientWith = (names: string[]) =>
    ({
      listLoadedPlugins: () => Promise.resolve(names.map((name) => ({ name }))),
    }) as unknown as Parameters<typeof verifyLoaded>[0];

  it("returns the declared plugins missing from the loaded set", async () => {
    const client = clientWith(["@centralit/plugin-resource-tenant"]);
    const missing = await verifyLoaded(client, [
      { name: "@centralit/plugin-resource-tenant", source: "x" },
      { name: "@centralit/plugin-auth-token", source: "y" },
    ]);
    expect(missing).toEqual(["@centralit/plugin-auth-token"]);
  });

  it("returns [] when every declared plugin loaded", async () => {
    const client = clientWith(["a", "b"]);
    const missing = await verifyLoaded(client, [
      { name: "a", source: "x" },
      { name: "b", source: "y" },
    ]);
    expect(missing).toEqual([]);
  });

  it("treats a failing listLoadedPlugins as 'none loaded'", async () => {
    const client = {
      listLoadedPlugins: () => Promise.reject(new Error("down")),
    } as unknown as Parameters<typeof verifyLoaded>[0];
    const missing = await verifyLoaded(client, [{ name: "a", source: "x" }]);
    expect(missing).toEqual(["a"]);
  });
});
