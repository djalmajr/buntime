import { join } from "node:path";
import { getChildLogger } from "@buntime/shared/logger";
import { DELAY_MS, IS_COMPILED, MessageTypes, WorkerState, type WorkerStatus } from "@/constants";
import type { WorkerConfig } from "./config";
import { computeAvgResponseTime, roundTwoDecimals } from "./stats";
import type { WorkerRequest, WorkerResponse } from "./types";

const logger = getChildLogger("WorkerInstance");

const WORKER_PATH = IS_COMPILED ? "./libs/pool/wrapper.ts" : join(import.meta.dir, "wrapper.ts");

/**
 * Security: Patterns that match sensitive environment variable names
 * These are filtered out to prevent accidental secret leakage to workers
 */
const SensitiveEnvPatterns = [
  /^(DATABASE|DB)_/i,
  /^(API|AUTH|SECRET|PRIVATE)_?KEY/i,
  /_TOKEN$/i,
  /_SECRET$/i,
  /_PASSWORD$/i,
  /^AWS_/i,
  /^GITHUB_/i,
  /^OPENAI_/i,
  /^ANTHROPIC_/i,
  /^STRIPE_/i,
] as const;

/**
 * Filter out sensitive environment variables from worker config
 * Logs a warning when sensitive vars are blocked
 */
function filterSensitiveEnv(env: Record<string, string> | undefined): Record<string, string> {
  if (!env) return {};

  const filtered: Record<string, string> = {};
  const blocked: string[] = [];

  for (const [key, value] of Object.entries(env)) {
    const isSensitive = SensitiveEnvPatterns.some((pattern) => pattern.test(key));
    if (isSensitive) {
      blocked.push(key);
    } else {
      filtered[key] = value;
    }
  }

  if (blocked.length > 0) {
    logger.warn("Blocked sensitive env vars from worker", { blocked });
  }

  return filtered;
}

export class WorkerInstance {
  private createdAt = Date.now();
  private errorCount = 0;
  private hasCriticalError = false;
  private hasIdleBeenSent = false;
  private lastUsedAt = Date.now();
  private readyPromise: Promise<void>;
  private requestCount = 0;
  private totalResponseTimeMs = 0;
  private worker: Worker;

  public readonly id: string;

  constructor(
    appDir: string,
    entrypoint: string,
    private config: WorkerConfig,
  ) {
    const ENTRYPOINT = join(appDir, entrypoint);

    this.id = crypto.randomUUID();

    // Security: Workers only receive explicit env vars, never inherit from runtime
    // Sensitive env vars are filtered out to prevent accidental secret leakage
    const safeEnv = filterSensitiveEnv(config.env);
    // Provide runtime API URL for internal HTTP calls (database, keyval, etc.)
    const runtimePort = Bun.env.PORT ?? "8000";
    const runtimeApiUrl = `http://127.0.0.1:${runtimePort}`;

    this.worker = new Worker(WORKER_PATH, {
      env: {
        ...safeEnv,
        APP_DIR: appDir,
        BUNTIME_API_URL: runtimeApiUrl,
        ENTRYPOINT,
        NODE_ENV: Bun.env.NODE_ENV ?? "development",
        WORKER_CONFIG: JSON.stringify(config),
        WORKER_ID: this.id,
      },
      smol: config.lowMemory,
    });

    // Wait for initial READY message with timeout and error handling
    // If worker fails to initialize (import error, syntax error), rejects instead of hanging
    const READY_TIMEOUT_MS = 30_000;

    this.readyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        this.hasCriticalError = true;
        reject(new Error(`Worker failed to become ready within ${READY_TIMEOUT_MS}ms`));
      }, READY_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
        this.worker.removeEventListener("message", handleReady);
        this.worker.removeEventListener("error", handleError);
      };

      const handleReady = ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.type === MessageTypes.READY) {
          cleanup();
          resolve();
        }
      };

      const handleError = (err: ErrorEvent) => {
        cleanup();
        this.hasCriticalError = true;
        logger.error(`Critical error for ${ENTRYPOINT}`, { error: err });
        reject(new Error(`Worker initialization failed: ${err.message}`));
      };

      this.worker.addEventListener("message", handleReady);
      this.worker.addEventListener("error", handleError);
    });
  }

  /**
   * Fetch a request through this worker
   * @param req - The request object (headers, method, url)
   * @param preReadBody - Optional pre-read body to avoid double-reading
   */
  async fetch(req: Request, preReadBody?: ArrayBuffer | null): Promise<Response> {
    // Wait for worker to be ready (only matters on first request)
    await this.readyPromise;

    this.requestCount++;
    this.lastUsedAt = Date.now();

    // Use pre-read body if available, otherwise read from request
    const body =
      preReadBody !== undefined ? (preReadBody ?? new ArrayBuffer(0)) : await req.arrayBuffer();
    const reqId = crypto.randomUUID();

    return new Promise<Response>((resolve, reject) => {
      const handleMessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.type !== MessageTypes.READY && data.reqId !== reqId) {
          return;
        }

        switch (data.type) {
          case MessageTypes.ERROR: {
            cleanup();
            this.errorCount++;
            // Log full error context server-side (stack trace from worker)
            logger.error("Worker request error", {
              error: data.error,
              stack: data.stack,
              workerId: this.id,
            });
            reject(new Error(data.error));
            break;
          }

          case MessageTypes.RESPONSE: {
            cleanup();
            const { body, headers, status } = data.res!;
            resolve(new Response(body, { headers, status }));
          }
        }
      };

      const handleError = (err: ErrorEvent) => {
        cleanup();
        this.hasCriticalError = true;
        this.errorCount++;
        reject(new Error(`Worker error during request: ${err.message}`));
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.worker.removeEventListener("message", handleMessage);
        this.worker.removeEventListener("error", handleError);
        if (this.config.ttlMs === 0) this.terminate();
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Worker timeout after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      this.worker.addEventListener("message", handleMessage);
      this.worker.addEventListener("error", handleError);

      const message: WorkerRequest = {
        type: MessageTypes.REQUEST,
        reqId,
        req: {
          body,
          headers: Object.fromEntries(req.headers.entries()),
          method: req.method,
          url: req.url,
        },
      };

      try {
        this.worker.postMessage(message, [body]);
      } catch (err) {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  getStatus(): WorkerStatus {
    return this.computeStatus(Date.now() - this.lastUsedAt);
  }

  getStats() {
    const now = Date.now();
    const idle = now - this.lastUsedAt;

    return {
      ageMs: now - this.createdAt,
      avgResponseTimeMs: computeAvgResponseTime(this.totalResponseTimeMs, this.requestCount),
      errorCount: this.errorCount,
      idleMs: idle,
      requestCount: this.requestCount,
      status: this.computeStatus(idle),
      totalResponseTimeMs: roundTwoDecimals(this.totalResponseTimeMs),
    };
  }

  private computeStatus(idle: number): WorkerStatus {
    if (idle < this.config.idleTimeoutMs) return WorkerState.ACTIVE;

    if (!this.hasIdleBeenSent) {
      this.hasIdleBeenSent = true;
      this.worker.postMessage({ type: MessageTypes.IDLE });
    }

    return WorkerState.IDLE;
  }

  isHealthy(): boolean {
    // Critical errors make worker permanently unhealthy
    if (this.hasCriticalError) return false;

    const { ageMs, idleMs } = this.getStats();

    return (
      ageMs < this.config.ttlMs &&
      idleMs < this.config.idleTimeoutMs &&
      this.requestCount < this.config.maxRequests
    );
  }

  async terminate() {
    try {
      this.worker.postMessage({ type: MessageTypes.TERMINATE });
      await Bun.sleep(DELAY_MS);
      this.worker.terminate();
    } catch (err) {
      // Worker may already be terminated - this is expected during cleanup
      logger.debug("terminate() error (worker may be gone)", { error: err });
    }
  }

  recordResponseTime(durationMs: number) {
    this.totalResponseTimeMs += durationMs;
  }

  touch() {
    this.lastUsedAt = Date.now();
  }
}
