import { join } from "node:path";
import { DELAY_MS } from "@/constants";
import type { WorkerConfig } from "./config";
import type { WorkerRequest, WorkerResponse } from "./types";

export class WorkerInstance {
  private createdAt = Date.now();
  private lastUsedAt = Date.now();
  private readyPromise: Promise<void>;
  private requestCount = 0;
  private idleSent = false;
  private worker: Worker;

  public readonly id: string;

  constructor(
    appDir: string,
    entrypoint: string,
    private config: WorkerConfig,
  ) {
    const wrapper = join(import.meta.dir, "wrapper.ts");
    const ENTRYPOINT = join(appDir, entrypoint);

    this.id = crypto.randomUUID();
    this.worker = new Worker(wrapper, {
      env: {
        ...Bun.env,
        APP_DIR: appDir,
        ENTRYPOINT,
        WORKER_ID: this.id,
      },
      smol: config.lowMemory,
    });

    this.worker.onerror = (err) => {
      console.error(`[WorkerInstance] Error for ${ENTRYPOINT}:`, err);
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
      const timeout = setTimeout(() => {
        reject(new Error(`Worker timeout after ${this.config.timeoutMs}ms`));
        if (this.config.ttlMs === 0) this.terminate();
      }, this.config.timeoutMs);

      const handleMessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.type !== "READY" && data.reqId !== reqId) {
          return;
        }

        switch (data.type) {
          case "ERROR": {
            clearTimeout(timeout);
            reject(new Error(data.error));
            this.worker.removeEventListener("message", handleMessage);
            if (this.config.ttlMs === 0) this.terminate();
            break;
          }

          case "RESPONSE": {
            clearTimeout(timeout);
            const { body, headers, status } = data.res!;
            resolve(new Response(body, { headers, status }));
            this.worker.removeEventListener("message", handleMessage);
            if (this.config.ttlMs === 0) this.terminate();
          }
        }
      };

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
    return {
      age: Date.now() - this.createdAt,
      idle: Date.now() - this.lastUsedAt,
      requestCount: this.requestCount,
      status: this.getStatus(),
    };
  }

  isHealthy(): boolean {
    const { age, idle } = this.getStats();

    return (
      age < this.config.ttlMs &&
      idle < this.config.idleTimeoutMs &&
      this.requestCount < this.config.maxRequests
    );
  }

  async terminate() {
    this.worker.postMessage({ type: "TERMINATE" });
    await Bun.sleep(DELAY_MS);
    this.worker.terminate();
  }

  touch() {
    this.lastUsedAt = Date.now();
  }
}
