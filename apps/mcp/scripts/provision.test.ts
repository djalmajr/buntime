import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packWorker } from "./provision.ts";

describe("packWorker", () => {
  let workDir: string;
  let appDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "provision-test-"));
    appDir = join(workDir, "app");
    await mkdir(appDir, { recursive: true });
    await writeFile(
      join(appDir, "manifest.yaml"),
      "entrypoint: index.ts\nenv:\n  AUTH_CONFIG: demo\n",
    );
    await writeFile(join(appDir, "index.ts"), "export default {};\n");
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  async function extract(tgz: string): Promise<string> {
    const out = join(workDir, "extract");
    await mkdir(out, { recursive: true });
    const proc = Bun.spawn(["tar", "-xzf", tgz, "-C", out], { stdout: "pipe", stderr: "pipe" });
    expect(await proc.exited).toBe(0);
    await rm(tgz, { force: true });
    return join(out, "package");
  }

  it("stages the --worker-env file as package/.env alongside the manifest", async () => {
    const envFile = join(workDir, "self-contained.env");
    await writeFile(envFile, "AUTH_CONFIG=incluster\nPUBLIC_TRANSLATE_API=/@hyper/translate/api\n");

    const pkg = await extract(await packWorker(appDir, join(appDir, "manifest.yaml"), envFile));

    expect(await readFile(join(pkg, ".env"), "utf8")).toContain("AUTH_CONFIG=incluster");
    // The chosen manifest is still packed (env overlay is merged OVER it at runtime).
    expect(await readFile(join(pkg, "manifest.yaml"), "utf8")).toContain("AUTH_CONFIG: demo");
    expect(await readdir(pkg)).toContain("index.ts");
  });

  it("omits .env when no --worker-env file is given", async () => {
    const pkg = await extract(await packWorker(appDir, join(appDir, "manifest.yaml")));

    const names = await readdir(pkg);
    expect(names).not.toContain(".env");
    expect(names).toContain("manifest.yaml");
  });
});
