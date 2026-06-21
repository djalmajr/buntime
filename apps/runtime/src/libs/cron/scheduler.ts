/**
 * Runtime-level cron scheduler.
 *
 * Buntime workers are pooled isolates retired on idle, so in-worker timers/cron do
 * NOT survive between requests. Instead, a worker declares `cron` jobs in its
 * manifest and the long-lived runtime fires them with `Bun.cron`, sending an
 * internal request to the worker's endpoint via `app.fetch`. The request carries
 * the runtime root key, which bypasses plugin `onRequest` gates and CSRF (see
 * app.ts), so it reaches the worker directly; external callers can't forge it.
 * Each fire is a bounded request that also keeps the worker warm.
 *
 * See the canonical rule: zommehq/buntime `_rules/app-jobs-and-storage`.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { CronJob } from "@buntime/shared/utils/worker-config";
import { Headers as RuntimeHeaders } from "@/constants";
import { loadWorkerConfig } from "@/libs/pool/config";
import { createWorkerResolver } from "@/utils/get-worker-dir";

/** `Bun.cron` is not yet in `@types/bun`; declare the minimal surface we use. */
type BunCronHandle = { stop: () => void };
const bunCron = (
  Bun as unknown as { cron: (schedule: string, handler: () => unknown) => BunCronHandle }
).cron;

const INTERNAL_ORIGIN = "http://runtime.internal";

type LogMeta = Record<string, unknown>;
interface MinimalLogger {
  info: (msg: string, meta?: LogMeta) => void;
  warn: (msg: string, meta?: LogMeta) => void;
  error: (msg: string, meta?: LogMeta) => void;
  debug?: (msg: string, meta?: LogMeta) => void;
}

export interface CronSchedulerDeps {
  /** The Hono app — cron fires go through it so worker routing/base handling is reused. */
  app: { fetch: (req: Request) => Response | Promise<Response> };
  /** Runtime root key, sent as X-API-Key so the internal fire bypasses plugin gates. */
  rootKey?: string;
  /** Worker install directories to scan for cron declarations. */
  workerDirs: string[];
  logger: MinimalLogger;
}

export interface DiscoveredCronJob extends CronJob {
  workerName: string;
  appDir: string;
}

export interface CronScheduler {
  stop: () => void;
  jobCount: number;
}

/** readdir(withFileTypes) that yields [] for a missing/unreadable dir. */
async function safeReaddir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** List installed worker names across all worker dirs (handles `@scope/name`). */
export async function listInstalledWorkerNames(workerDirs: string[]): Promise<string[]> {
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

/** Discover every cron job declared by an installed, enabled worker. */
export async function discoverCronJobs(workerDirs: string[]): Promise<DiscoveredCronJob[]> {
  const resolve = createWorkerResolver(workerDirs);
  const names = await listInstalledWorkerNames(workerDirs);
  const jobs: DiscoveredCronJob[] = [];
  for (const workerName of names) {
    let appDir: string;
    try {
      appDir = resolve(workerName);
    } catch {
      continue;
    }
    if (!appDir) continue;
    let config: Awaited<ReturnType<typeof loadWorkerConfig>>;
    try {
      config = await loadWorkerConfig(appDir);
    } catch {
      continue;
    }
    if (config.enabled === false) continue;
    for (const cron of config.cron ?? []) {
      if (!cron?.schedule || !cron?.endpoint) continue;
      jobs.push({
        appDir,
        endpoint: cron.endpoint,
        method: cron.method,
        schedule: cron.schedule,
        workerName,
      });
    }
  }
  return jobs;
}

/** Build the internal request the runtime sends to a worker on a cron fire. */
export function buildCronRequest(workerName: string, job: CronJob, rootKey?: string): Request {
  const path = job.endpoint.startsWith("/") ? job.endpoint : `/${job.endpoint}`;
  const headers: Record<string, string> = {
    [RuntimeHeaders.CRON]: "true",
    [RuntimeHeaders.INTERNAL]: "true",
  };
  if (rootKey) headers[RuntimeHeaders.API_KEY] = rootKey;
  return new Request(`${INTERNAL_ORIGIN}/${workerName}${path}`, {
    headers,
    method: job.method ?? "POST",
  });
}

/**
 * Start the runtime cron scheduler. Scans installed workers, schedules each
 * declared cron job with `Bun.cron`, and returns a handle to stop them all.
 * Overlapping fires of the same job are skipped (the previous fire is still
 * in flight).
 */
export async function startCronScheduler(deps: CronSchedulerDeps): Promise<CronScheduler> {
  const { app, logger, rootKey, workerDirs } = deps;
  const jobs = await discoverCronJobs(workerDirs);
  const handles: BunCronHandle[] = [];
  const inFlight = new Set<string>();

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
          const res = await app.fetch(buildCronRequest(job.workerName, job, rootKey));
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
    logger.info(`Cron scheduler started (${handles.length} job(s))`);
  }

  return {
    jobCount: handles.length,
    stop: () => {
      for (const handle of handles) handle.stop();
    },
  };
}
