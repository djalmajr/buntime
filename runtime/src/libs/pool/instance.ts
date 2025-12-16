import { join } from "node:path";
import { DELAY_MS, IS_COMPILED } from "@/constants";
import type { WorkerConfig } from "./config";
import type { WorkerRequest, WorkerResponse } from "./types";

const WORKER_PATH = IS_COMPILED ? "./libs/pool/wrapper.ts" : join(import.meta.dir, "wrapper.ts");

export class WorkerInstance {
  private createdAt = Date.now();
  private errorCount = 0;
  private hasCriticalError = false;
  private idleSent = false;
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
    this.worker = new Worker(WORKER_PATH, {
      env: {
        ...Bun.env,
        ...config.env, // Additional env vars from config
        APP_DIR: appDir,
        ENTRYPOINT,
        WORKER_CONFIG: JSON.stringify(config),
        WORKER_ID: this.id,
      },
      smol: config.lowMemory,
    });

    this.worker.onerror = (err) => {
      console.error(`[WorkerInstance] Critical error for ${ENTRYPOINT}:`, err);
      this.hasCriticalError = true;
    };

    // Wait for initial READY message
    this.readyPromise = new Promise<void>((resolve) => {
      const handleReady = ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.type === "READY") {
          this.worker.removeEventListener("message", handleReady);
          resolve();
        }
      };
      this.worker.addEventListener("message", handleReady);
    });
  }

  async fetch(req: Request): Promise<Response> {
    // Wait for worker to be ready (only matters on first request)
    await this.readyPromise;

    this.requestCount++;
    this.lastUsedAt = Date.now();

    const body = await req.arrayBuffer();
    const reqId = crypto.randomUUID();

    return new Promise<Response>((resolve, reject) => {
      const handleMessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.type !== "READY" && data.reqId !== reqId) {
          return;
        }

        switch (data.type) {
          case "ERROR": {
            cleanup();
            this.errorCount++;
            reject(new Error(data.error));
            break;
          }

          case "RESPONSE": {
            cleanup();
            const { body, headers, status } = data.res!;
            resolve(new Response(body, { headers, status }));
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.worker.removeEventListener("message", handleMessage);
        if (this.config.ttlMs === 0) this.terminate();
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Worker timeout after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      this.worker.addEventListener("message", handleMessage);

      const message: WorkerRequest = {
        type: "REQUEST",
        reqId,
        req: {
          body,
          headers: Object.fromEntries(req.headers.entries()),
          method: req.method,
          url: req.url,
        },
      };

      this.worker.postMessage(message, [body]);
    });
  }

  getStatus(): "active" | "idle" {
    const idle = Date.now() - this.lastUsedAt;

    if (idle < this.config.idleTimeoutMs) return "active";

    if (!this.idleSent) {
      this.idleSent = true;
      this.worker.postMessage({ type: "IDLE" });
    }

    return "idle";
  }

  getStats() {
    const avgResponseTimeMs =
      this.requestCount > 0 ? this.totalResponseTimeMs / this.requestCount : 0;

    return {
      age: Date.now() - this.createdAt,
      avgResponseTimeMs: Math.round(avgResponseTimeMs * 100) / 100,
      errorCount: this.errorCount,
      idle: Date.now() - this.lastUsedAt,
      requestCount: this.requestCount,
      status: this.getStatus(),
      totalResponseTimeMs: Math.round(this.totalResponseTimeMs * 100) / 100,
    };
  }

  isHealthy(): boolean {
    // Critical errors make worker permanently unhealthy
    if (this.hasCriticalError) return false;

    const { age, idle } = this.getStats();

    return (
      age < this.config.ttlMs &&
      idle < this.config.idleTimeoutMs &&
      this.requestCount < this.config.maxRequests
    );
  }

  async terminate() {
    try {
      this.worker.postMessage({ type: "TERMINATE" });
      await Bun.sleep(DELAY_MS);
      this.worker.terminate();
    } catch (err) {
      // Worker may already be terminated - this is expected during cleanup
      console.debug("[WorkerInstance] terminate() error (worker may be gone):", err);
    }
  }

  recordResponseTime(durationMs: number) {
    this.totalResponseTimeMs += durationMs;
  }

  touch() {
    this.lastUsedAt = Date.now();
  }
}
