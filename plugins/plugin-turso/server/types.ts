import type { BasePluginConfig } from "@buntime/shared/types";

export const TURSO_DEFAULT_LOCAL_PATH = "./data/turso/runtime.db";
export const TURSO_DEFAULT_MAX_RETRIES = 5;
export const TURSO_DEFAULT_NAMESPACE = "runtime";
export const TURSO_DEFAULT_RETRY_DELAY_MS = 5;

export type TursoBindValue = bigint | boolean | null | number | string | Uint8Array;
export type TursoMode = "local" | "sync";
export type TursoRow = Record<string, unknown>;
export type TursoTransactionType = "concurrent" | "deferred" | "exclusive" | "immediate";

export interface TursoHealth {
  connected: boolean;
  error?: string;
  localPath: string;
  mode: TursoMode;
  namespaces: string[];
  ok: boolean;
  sync: TursoSyncHealth;
}

export interface TursoPluginConfig extends BasePluginConfig {
  localPath?: string;
  mode?: string;
  sync?: TursoSyncPluginConfig;
}

export interface TursoResolvedConfig {
  localPath: string;
  mode: TursoMode;
  sync?: TursoResolvedSyncConfig;
}

export interface TursoResolvedSyncConfig {
  authToken?: string;
  url: string;
}

export interface TursoRunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface TursoService {
  close(): Promise<void>;
  connect(namespace?: string): Promise<TursoDatabase>;
  health(): Promise<TursoHealth>;
  transaction<T>(
    options: TursoTransactionOptions,
    callback: (db: TursoDatabase) => Promise<T>,
  ): Promise<T>;
}

export interface TursoStatement {
  all<T = TursoRow>(...bindParameters: TursoBindValue[]): Promise<T[]>;
  get<T = TursoRow>(...bindParameters: TursoBindValue[]): Promise<T | null>;
  run(...bindParameters: TursoBindValue[]): Promise<TursoRunResult>;
}

export interface TursoSyncHealth {
  enabled: boolean;
  stats?: TursoSyncStats;
  url?: string;
}

export interface TursoSyncPluginConfig {
  authToken?: string;
  url?: string;
}

export interface TursoSyncStats {
  cdcOperations: number;
  lastPullUnixTime: number;
  lastPushUnixTime: number | null;
  mainWalSize: number;
  networkReceivedBytes: number;
  networkSentBytes: number;
  revertWalSize: number;
  revision: string | null;
}

export interface TursoTransactionOptions {
  maxRetries?: number;
  namespace?: string;
  retryDelayMs?: number;
  type?: TursoTransactionType;
}

export interface TursoDatabase {
  readonly localPath: string;
  readonly mode: TursoMode;
  checkpoint(): Promise<void>;
  close(): Promise<void>;
  exec(sql: string): Promise<void>;
  getRawClient(): TursoRawClient;
  getSyncStats(): Promise<TursoSyncStats | null>;
  prepare(sql: string): TursoStatement;
  pull(): Promise<boolean>;
  push(): Promise<void>;
  transaction<T>(callback: (db: TursoDatabase) => Promise<T>): Promise<T>;
}

export interface TursoRawClient {
  close(): Promise<void>;
  exec(sql: string): Promise<void>;
  prepare(sql: string): TursoStatement;
  transaction<T>(
    callback: (...bindParameters: TursoBindValue[]) => Promise<T>,
  ): (...bindParameters: TursoBindValue[]) => Promise<T>;
}

export interface TursoRawSyncClient extends TursoRawClient {
  checkpoint(): Promise<void>;
  pull(): Promise<boolean>;
  push(): Promise<void>;
  stats(): Promise<TursoSyncStats>;
}
