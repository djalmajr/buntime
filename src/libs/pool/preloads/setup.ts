import type { WorkerConfig } from "@/libs/pool/config";

const { APP_DIR, WORKER_CONFIG } = Bun.env;

if (!APP_DIR || !WORKER_CONFIG) {
  throw new Error("APP_DIR or WORKER_CONFIG env var is missing in preload");
}

const config: WorkerConfig = JSON.parse(WORKER_CONFIG);

if (config.autoInstall) {
  const result = Bun.spawnSync(["bun", "install", "--frozen-lockfile"], {
    cwd: APP_DIR,
    stderr: "pipe",
    stdout: "pipe",
  });

  if (!result.success) {
    throw new Error(
      `[preload-setup] bun install failed in ${APP_DIR}: ${result.stderr.toString()}`,
    );
  }
}
