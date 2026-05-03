import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ValidationError } from "@buntime/shared/errors";
import type { PluginLogger } from "@buntime/shared/types";
import { connect as connectLocal } from "@tursodatabase/database";
import {
  connect as connectSync,
  type DatabaseOpts as TursoSyncDatabaseOpts,
} from "@tursodatabase/sync";
import type {
  TursoDatabase,
  TursoRawClient,
  TursoRawSyncClient,
  TursoResolvedConfig,
  TursoStatement,
  TursoSyncStats,
} from "./types.ts";

interface TursoAdapterOptions {
  client: TursoRawClient;
  config: TursoResolvedConfig;
  logger: PluginLogger;
  syncClient?: TursoRawSyncClient;
}

interface TursoAdapterOpenOptions {
  config: TursoResolvedConfig;
  logger: PluginLogger;
}

function ensureDatabaseDirectory(localPath: string): void {
  if (localPath === ":memory:" || localPath.startsWith("file:") || localPath.includes("://")) {
    return;
  }

  mkdirSync(dirname(localPath), { recursive: true });
}

function getSyncOptions(config: TursoResolvedConfig): TursoSyncDatabaseOpts {
  if (!config.sync?.url) {
    throw new ValidationError(
      "Turso sync mode requires TURSO_SYNC_URL or sync.url.",
      "TURSO_SYNC_URL_REQUIRED",
    );
  }

  return {
    authToken: config.sync.authToken,
    path: config.localPath,
    url: config.sync.url,
  };
}

export class TursoAdapter implements TursoDatabase {
  readonly localPath: string;
  readonly mode: TursoResolvedConfig["mode"];

  private closed = false;
  private readonly client: TursoRawClient;
  private readonly logger: PluginLogger;
  private readonly syncClient?: TursoRawSyncClient;

  private constructor(options: TursoAdapterOptions) {
    this.client = options.client;
    this.localPath = options.config.localPath;
    this.logger = options.logger;
    this.mode = options.config.mode;
    this.syncClient = options.syncClient;
  }

  static async open(options: TursoAdapterOpenOptions): Promise<TursoAdapter> {
    ensureDatabaseDirectory(options.config.localPath);

    if (options.config.mode === "sync") {
      const client = await connectSync(getSyncOptions(options.config));
      const adapter = new TursoAdapter({
        client,
        config: options.config,
        logger: options.logger,
        syncClient: client,
      });
      await adapter.enableMvcc();
      return adapter;
    }

    const client = await connectLocal(options.config.localPath);
    const adapter = new TursoAdapter({
      client,
      config: options.config,
      logger: options.logger,
    });
    await adapter.enableMvcc();
    return adapter;
  }

  async checkpoint(): Promise<void> {
    await this.syncClient?.checkpoint();
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    await this.client.close();
  }

  async exec(sql: string): Promise<void> {
    await this.client.exec(sql);
  }

  getRawClient(): TursoRawClient {
    return this.client;
  }

  async getSyncStats(): Promise<TursoSyncStats | null> {
    return (await this.syncClient?.stats()) ?? null;
  }

  prepare(sql: string): TursoStatement {
    return this.client.prepare(sql);
  }

  async pull(): Promise<boolean> {
    return (await this.syncClient?.pull()) ?? false;
  }

  async push(): Promise<void> {
    await this.syncClient?.push();
  }

  async transaction<T>(callback: (db: TursoDatabase) => Promise<T>): Promise<T> {
    const transaction = this.client.transaction(async () => callback(this));
    return transaction();
  }

  private async enableMvcc(): Promise<void> {
    await this.client.exec("PRAGMA journal_mode = mvcc");
    this.logger.debug(`Turso MVCC journal mode enabled: ${this.localPath}`);
  }
}
