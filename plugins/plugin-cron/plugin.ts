/**
 * Cron plugin for Buntime — runtime-level scheduled jobs for workers.
 *
 * Workers are pooled isolates retired on idle, so in-worker timers/cron do not
 * survive. A worker declares `cron: [{ schedule, endpoint }]` in its manifest;
 * this plugin (running in the long-lived runtime) fires each schedule with
 * `Bun.cron` and invokes the worker via `ctx.pool.fetch` — a direct, in-process
 * call that bypasses plugins/CSRF entirely (truly internal; not reachable from
 * outside). Each fire is bounded, keeps the worker warm, and overlapping fires
 * are skipped. Self-contained: discovers workers by scanning the worker dirs and
 * parsing manifests, so it never reaches into runtime internals.
 *
 * Lean-core by design: this lives as a plugin, and any failure here is isolated
 * by the runtime (see core fault-isolation) — it can never crash the workers.
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PluginContext, PluginImpl } from "@buntime/shared/types";
import {
  type CronJob,
  parseWorkerConfig,
  type WorkerConfig,
  type WorkerManifest,
} from "@buntime/shared/utils/worker-config";

/** `Bun.cron` is not yet in `@types/bun`; declare the minimal surface we use. */
type BunCronHandle = { stop: () => void };
const bunCron = (
  Bun as unknown as { cron: (schedule: string, handler: () => unknown) => BunCronHandle }
).cron;
/** `Bun.semver.order` for picking the latest installed version. */
const semverOrder = (Bun as unknown as { semver?: { order: (a: string, b: string) => number } })
  .semver?.order;

const INTERNAL_ORIGIN = "http://runtime.internal";

interface PoolLike {
  fetch(appDir: string, config: WorkerConfig, req: Request): Promise<Response>;
}

interface MinimalLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  debug?: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface DiscoveredCronJob extends CronJob {
  workerName: string;
  appDir: string;
}

async function safeReaddir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** List installed worker names across all worker dirs (handles `@scope/name`). */
export async function listWorkerNames(workerDirs: string[]): Promise<string[]> {
  const names = new Set<string>();
  for (const dir of workerDirs) {
    for (const entry of await safeReaddir(dir)) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith("@")) {
        for (const sub of await safeReaddir(join(dir, entry.name))) {
          if (sub.isDirectory()) names.add(`${entry.name}/${sub.name}`);
        }
      } else {
        names.add(entry.name);
      }
    }
  }
  return [...names];
}

/** Resolve a worker name to the app dir holding its manifest (flat or latest version). */
export async function resolveAppDir(workerDirs: string[], name: string): Promise<string | null> {
  for (const base of workerDirs) {
    const nameDir = join(base, name);
    if (
      (await exists(join(nameDir, "manifest.yaml"))) ||
      (await exists(join(nameDir, "manifest.yml")))
    ) {
      return nameDir; // flat layout
    }
    const versions = (await safeReaddir(nameDir))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => (semverOrder ? semverOrder(a, b) : a.localeCompare(b)));
    for (const version of versions.reverse()) {
      const versionDir = join(nameDir, version);
      if (
        (await exists(join(versionDir, "manifest.yaml"))) ||
        (await exists(join(versionDir, "manifest.yml")))
      ) {
        return versionDir; // latest installed version
      }
    }
  }
  return null;
}

async function readManifest(appDir: string): Promise<WorkerManifest | null> {
  for (const file of ["manifest.yaml", "manifest.yml"]) {
    const path = join(appDir, file);
    if (await exists(path)) {
      try {
        return (Bun as unknown as { YAML: { parse: (s: string) => unknown } }).YAML.parse(
          await Bun.file(path).text(),
        ) as WorkerManifest;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Discover every cron job declared by an installed, enabled worker. */
export async function discoverCronJobs(
  workerDirs: string[],
): Promise<Array<DiscoveredCronJob & { config: WorkerConfig }>> {
  const jobs: Array<DiscoveredCronJob & { config: WorkerConfig }> = [];
  for (const workerName of await listWorkerNames(workerDirs)) {
    const appDir = await resolveAppDir(workerDirs, workerName);
    if (!appDir) continue;
    const manifest = await readManifest(appDir);
    if (!manifest) continue;
    const config = parseWorkerConfig(manifest);
    if (config.enabled === false || !config.cron?.length) continue;
    for (const cron of config.cron) {
      if (!cron?.schedule || !cron?.endpoint) continue;
      jobs.push({
        appDir,
        config,
        endpoint: cron.endpoint,
        method: cron.method,
        schedule: cron.schedule,
        workerName,
      });
    }
  }
  return jobs;
}

/** Build the internal request sent straight to a worker via the pool on a fire. */
export function buildCronRequest(job: CronJob): Request {
  const path = job.endpoint.startsWith("/") ? job.endpoint : `/${job.endpoint}`;
  return new Request(`${INTERNAL_ORIGIN}${path}`, {
    headers: {
      // pool.fetch bypasses plugins/CSRF; x-base keeps the worker's own routing,
      // x-buntime-cron lets the worker tell a scheduled fire from real traffic.
      "x-base": "/",
      "x-buntime-cron": "true",
      "x-buntime-internal": "true",
    },
    method: job.method ?? "POST",
  });
}

export default function cronPlugin(): PluginImpl {
  let pool: PoolLike;
  let workerDirs: string[] = [];
  let logger: MinimalLogger;
  const handles: BunCronHandle[] = [];
  const inFlight = new Set<string>();

  return {
    onInit(ctx: PluginContext) {
      pool = ctx.pool as PoolLike;
      workerDirs = ctx.globalConfig.workerDirs;
      logger = ctx.logger as MinimalLogger;
    },

    async onServerStart() {
      const jobs = await discoverCronJobs(workerDirs);
      for (const job of jobs) {
        const key = `${job.workerName} ${job.schedule} ${job.endpoint}`;
        try {
          const handle = bunCron(job.schedule, async () => {
            if (inFlight.has(key)) {
              logger.warn("Cron fire skipped: previous run still in flight", { job: key });
              return;
            }
            inFlight.add(key);
            try {
              const res = await pool.fetch(job.appDir, job.config, buildCronRequest(job));
              if (res.ok) {
                logger.debug?.("Cron fire ok", { job: key, status: res.status });
              } else {
                logger.warn("Cron fire returned non-2xx", { job: key, status: res.status });
              }
            } catch (error) {
              logger.error("Cron fire failed", { error, job: key });
            } finally {
              inFlight.delete(key);
            }
          });
          handles.push(handle);
          logger.info(`Cron scheduled: ${job.workerName} ${job.schedule} -> ${job.endpoint}`);
        } catch (error) {
          logger.error("Invalid cron schedule, skipping", { error, job: key });
        }
      }
      if (handles.length > 0) {
        logger.info(`Cron plugin started (${handles.length} job(s))`);
      }
    },

    onShutdown() {
      for (const handle of handles) handle.stop();
      handles.length = 0;
    },
  };
}
