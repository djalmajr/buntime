import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { LogEntry, LogTransport } from "../types";

/**
 * File transport options
 */
export interface FileTransportOptions {
  /**
   * Buffer size before flushing (number of entries)
   * @default 100
   */
  bufferSize?: number;
  /**
   * Flush interval in ms
   * @default 5000
   */
  flushInterval?: number;
  /**
   * Path to log file
   */
  path: string;
}

/**
 * File transport for logging
 * Buffers entries and writes to file periodically
 */
export class FileTransport implements LogTransport {
  private buffer: string[] = [];
  private readonly bufferSize: number;
  private flushTimer: Timer | null = null;
  private initialized = false;
  private readonly path: string;

  constructor(options: FileTransportOptions) {
    this.path = options.path;
    this.bufferSize = options.bufferSize ?? 100;

    // Start flush interval
    const interval = options.flushInterval ?? 5000;
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {
        // Ignore flush errors in interval
      });
    }, interval);
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    // Ensure directory exists on first write
    if (!this.initialized) {
      await mkdir(dirname(this.path), { recursive: true });
      this.initialized = true;
    }

    // Take current buffer and clear
    const lines = this.buffer;
    this.buffer = [];

    // Write all lines at once
    await appendFile(this.path, `${lines.join("\n")}\n`);
  }

  write(entry: LogEntry): void {
    const line = JSON.stringify({
      level: entry.level,
      message: entry.message,
      time: entry.timestamp,
      ...(entry.context && { context: entry.context }),
      ...(entry.meta && Object.keys(entry.meta).length > 0 && entry.meta),
    });

    this.buffer.push(line);

    // Flush if buffer is full
    if (this.buffer.length >= this.bufferSize) {
      this.flush().catch(() => {
        // Ignore flush errors
      });
    }
  }
}
