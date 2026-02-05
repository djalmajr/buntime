/**
 * Request Log Entry
 */
export interface RequestLogEntry {
  /** Unique identifier */
  id: string;
  /** Timestamp when request was received */
  timestamp: number;
  /** Client IP address */
  ip: string;
  /** HTTP method */
  method: string;
  /** Request path */
  path: string;
  /** Response status code */
  status: number;
  /** Request duration in milliseconds */
  duration: number;
  /** Whether request was rate limited */
  rateLimited: boolean;
}

/**
 * Filter options for querying logs
 */
export interface LogFilterOptions {
  /** Filter by IP address */
  ip?: string;
  /** Filter by path (regex) */
  pathPattern?: RegExp;
  /** Filter by status code */
  status?: number;
  /** Filter by status range (e.g., 4 for 4xx) */
  statusRange?: number;
  /** Only rate limited requests */
  rateLimited?: boolean;
  /** Maximum results */
  limit?: number;
}

/**
 * Request Logger with Ring Buffer
 *
 * Maintains a fixed-size buffer of recent requests.
 * When full, oldest entries are automatically removed.
 */
export class RequestLogger {
  private buffer: RequestLogEntry[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  /**
   * Generate a unique ID for log entries
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Log a request
   */
  log(entry: Omit<RequestLogEntry, "id" | "timestamp">): RequestLogEntry {
    const logEntry: RequestLogEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      ...entry,
    };

    this.buffer.push(logEntry);

    // Remove oldest if buffer is full
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }

    return logEntry;
  }

  /**
   * Get recent log entries
   * @param limit - Maximum number of entries to return (default: 50)
   * @returns Entries sorted by timestamp (newest first)
   */
  getRecent(limit = 50): RequestLogEntry[] {
    return this.buffer.slice(-limit).reverse();
  }

  /**
   * Get all log entries
   * @returns All entries sorted by timestamp (newest first)
   */
  getAll(): RequestLogEntry[] {
    return [...this.buffer].reverse();
  }

  /**
   * Filter log entries
   */
  filter(options: LogFilterOptions): RequestLogEntry[] {
    let result = [...this.buffer];

    if (options.ip) {
      result = result.filter((e) => e.ip === options.ip);
    }

    if (options.pathPattern) {
      result = result.filter((e) => options.pathPattern!.test(e.path));
    }

    if (options.status !== undefined) {
      result = result.filter((e) => e.status === options.status);
    }

    if (options.statusRange !== undefined) {
      const min = options.statusRange * 100;
      const max = min + 99;
      result = result.filter((e) => e.status >= min && e.status <= max);
    }

    if (options.rateLimited !== undefined) {
      result = result.filter((e) => e.rateLimited === options.rateLimited);
    }

    // Sort by timestamp (newest first) and apply limit
    result = result.reverse();

    if (options.limit) {
      result = result.slice(0, options.limit);
    }

    return result;
  }

  /**
   * Get statistics about logged requests
   */
  getStats(): {
    total: number;
    rateLimited: number;
    byStatus: Record<string, number>;
    avgDuration: number;
  } {
    const total = this.buffer.length;
    const rateLimited = this.buffer.filter((e) => e.rateLimited).length;

    const byStatus: Record<string, number> = {};
    let totalDuration = 0;

    for (const entry of this.buffer) {
      const statusGroup = `${Math.floor(entry.status / 100)}xx`;
      byStatus[statusGroup] = (byStatus[statusGroup] || 0) + 1;
      totalDuration += entry.duration;
    }

    return {
      total,
      rateLimited,
      byStatus,
      avgDuration: total > 0 ? totalDuration / total : 0,
    };
  }

  /**
   * Get unique IPs from logs
   */
  getUniqueIps(): string[] {
    const ips = new Set<string>();
    for (const entry of this.buffer) {
      ips.add(entry.ip);
    }
    return Array.from(ips);
  }

  /**
   * Clear all log entries
   */
  clear(): void {
    this.buffer = [];
  }

  /**
   * Get current buffer size
   */
  get size(): number {
    return this.buffer.length;
  }

  /**
   * Get maximum buffer size
   */
  get capacity(): number {
    return this.maxSize;
  }
}
