/**
 * @module
 * First-class Turso access for Buntime **workers** (apps).
 *
 * Plugins reach Turso through `ctx.getPlugin("@buntime/plugin-turso")`, but
 * workers run in isolated `Worker` threads with no plugin context. `openTurso`
 * gives a worker a namespaced Turso connection with a single call, using the
 * same bundled drivers as the runtime's {@link ApiKeyStore}
 * (`@tursodatabase/database` local mode, `@tursodatabase/sync` embedded replica).
 *
 * Connection is resolved from the worker env that the runtime forwards
 * (see `apps/runtime/src/libs/pool/instance.ts`):
 *
 * - `RUNTIME_TURSO_SERVER_URL` set → **sync** mode: a per-namespace embedded
 *   replica at `<dir>/<namespace>.db` synced with `<serverUrl>/<namespace>` on
 *   the in-cluster `turso-server`. Reads are local; `push()` ships writes,
 *   `pull()` fetches remote changes.
 * - otherwise → **local** mode: a standalone Turso file at `<dir>/<namespace>.db`
 *   (MVCC journal). `pull`/`push` are no-ops. Good for single-pod/dev.
 *
 * `<dir>` comes from `opts.dir`, else `RUNTIME_TURSO_DIR`, else `./.cache/turso`.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { connect as connectLocal } from "@tursodatabase/database";
import { connect as connectSync } from "@tursodatabase/sync";
import { ValidationError } from "./errors";

const NAMESPACE_PATTERN = /^[a-zA-Z0-9_-]+$/;
const DEFAULT_TURSO_DIR = "./.cache/turso";

/** Prepared-statement surface shared by both drivers (subset we use). */
export interface TursoStatement {
  all<T = unknown>(...bind: unknown[]): Promise<T[]>;
  get<T = unknown>(...bind: unknown[]): Promise<T | null>;
  run(...bind: unknown[]): Promise<{ changes: number; lastInsertRowid: number }>;
}

/** Thin Turso client returned by {@link openTurso}. */
export interface TursoClient {
  readonly mode: "local" | "sync";
  exec(sql: string): Promise<void>;
  prepare(sql: string): TursoStatement;
  /** Fetch remote changes (sync mode); no-op in local mode. */
  pull(): Promise<boolean>;
  /** Ship local writes to the primary (sync mode); no-op in local mode. */
  push(): Promise<void>;
  close(): Promise<void>;
}

export interface OpenTursoOptions {
  /** Sync server base URL. Default: `RUNTIME_TURSO_SERVER_URL`. Empty → local mode. */
  serverUrl?: string;
  /** Auth token for the sync server. Default: `RUNTIME_TURSO_SERVER_TOKEN`. */
  authToken?: string;
  /** Directory for the local (replica) database file. Default: `RUNTIME_TURSO_DIR` or `./.cache/turso`. */
  dir?: string;
}

/** Raw driver shape — both drivers expose this subset; sync adds pull/push. */
interface RawClient {
  close(): Promise<void>;
  exec(sql: string): Promise<void>;
  prepare(sql: string): TursoStatement;
}
interface SyncClient extends RawClient {
  pull(): Promise<boolean>;
  push(): Promise<void>;
}

function resolveDir(opts?: OpenTursoOptions): string {
  return opts?.dir ?? (Bun.env.RUNTIME_TURSO_DIR || DEFAULT_TURSO_DIR);
}

function resolveServerUrl(opts?: OpenTursoOptions): string | undefined {
  const url = (opts?.serverUrl ?? Bun.env.RUNTIME_TURSO_SERVER_URL ?? "").trim();
  return url ? url.replace(/\/$/, "") : undefined;
}

/**
 * Open a namespaced Turso connection for the current worker. Creates the local
 * file/replica directory, connects (sync when a server URL is configured, else
 * local with MVCC), and returns a thin {@link TursoClient}. The caller owns the
 * schema (`CREATE TABLE IF NOT EXISTS ...`) and the read/write/`pull`/`push` flow.
 */
export async function openTurso(namespace: string, opts?: OpenTursoOptions): Promise<TursoClient> {
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new ValidationError(
      `Invalid Turso namespace: ${namespace}. Use letters, numbers, hyphens, or underscores.`,
      "INVALID_TURSO_NAMESPACE",
    );
  }

  const dir = resolveDir(opts);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${namespace}.db`);
  const serverUrl = resolveServerUrl(opts);

  if (serverUrl) {
    const authToken =
      (opts?.authToken ?? Bun.env.RUNTIME_TURSO_SERVER_TOKEN ?? "").trim() || undefined;
    const client = (await connectSync({
      authToken,
      path,
      url: `${serverUrl}/${namespace}`,
    } as unknown as Parameters<typeof connectSync>[0])) as unknown as SyncClient;
    return wrapSync(client);
  }

  const client = (await connectLocal(path)) as unknown as RawClient;
  // MVCC only on standalone local files (CDC vs MVCC are mutually exclusive on
  // sync replicas — mirrors ApiKeyStore / plugin-turso adapter).
  await client.exec("PRAGMA journal_mode = mvcc");
  return wrapLocal(client);
}

function wrapLocal(client: RawClient): TursoClient {
  return {
    mode: "local",
    exec: (sql) => client.exec(sql),
    prepare: (sql) => client.prepare(sql),
    pull: async () => false,
    push: async () => {},
    close: () => client.close(),
  };
}

function wrapSync(client: SyncClient): TursoClient {
  return {
    mode: "sync",
    exec: (sql) => client.exec(sql),
    prepare: (sql) => client.prepare(sql),
    pull: () => client.pull(),
    push: () => client.push(),
    close: () => client.close(),
  };
}
