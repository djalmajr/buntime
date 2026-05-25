import type { TursoBindValue, TursoDatabase, TursoService } from "@buntime/plugin-turso";
import { ValidationError } from "@buntime/shared/errors";

export interface KeyValSqlStatement {
  args?: unknown[];
  sql: string;
}

export interface KeyValTransactionAdapter {
  execute<T = unknown>(sql: string, args?: unknown[]): Promise<T[]>;
  executeOne<T = unknown>(sql: string, args?: unknown[]): Promise<T | null>;
}

export interface KeyValSqlAdapter extends KeyValTransactionAdapter {
  batch(statements: KeyValSqlStatement[]): Promise<void>;
  close(): Promise<void>;
  transaction<T>(fn: (tx: KeyValTransactionAdapter) => Promise<T>): Promise<T>;
}

interface TursoKeyValAdapterOptions {
  namespace?: string;
  onClose?: () => Promise<void> | void;
  service: TursoService;
}

const DDL_SQL_PATTERN = /^\s*(ALTER|CREATE|DROP)\b/i;
const READ_SQL_PATTERN = /^\s*(EXPLAIN|PRAGMA|SELECT|WITH)\b/i;
const RETURNING_SQL_PATTERN = /\bRETURNING\b/i;

function isTursoBindValue(value: unknown): value is TursoBindValue {
  return (
    value === null ||
    typeof value === "bigint" ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string" ||
    value instanceof Uint8Array
  );
}

function normalizeBindValues(args: unknown[] | undefined): TursoBindValue[] {
  if (!args) {
    return [];
  }

  return args.map((value) => {
    if (isTursoBindValue(value)) {
      return value;
    }

    throw new ValidationError("Unsupported SQL bind value for KeyVal storage.", "INVALID_SQL_BIND");
  });
}

function containsDdl(statements: KeyValSqlStatement[]): boolean {
  return statements.some((statement) => DDL_SQL_PATTERN.test(statement.sql));
}

function shouldReadRows(sql: string): boolean {
  return READ_SQL_PATTERN.test(sql) || RETURNING_SQL_PATTERN.test(sql);
}

class TursoKeyValTransactionAdapter implements KeyValTransactionAdapter {
  constructor(private readonly db: TursoDatabase) {}

  async execute<T = unknown>(sql: string, args?: unknown[]): Promise<T[]> {
    const bindValues = normalizeBindValues(args);

    if (shouldReadRows(sql)) {
      return this.db.prepare(sql).all<T>(...bindValues);
    }

    if (bindValues.length === 0 && DDL_SQL_PATTERN.test(sql)) {
      await this.db.exec(sql);
      return [];
    }

    await this.db.prepare(sql).run(...bindValues);
    return [];
  }

  async executeOne<T = unknown>(sql: string, args?: unknown[]): Promise<T | null> {
    const bindValues = normalizeBindValues(args);
    return this.db.prepare(sql).get<T>(...bindValues);
  }
}

export class TursoKeyValAdapter implements KeyValSqlAdapter {
  private readonly namespace: string;
  private readonly onClose: (() => Promise<void> | void) | undefined;
  private readonly service: TursoService;

  constructor(options: TursoKeyValAdapterOptions) {
    this.namespace = options.namespace ?? "keyval";
    this.onClose = options.onClose;
    this.service = options.service;
  }

  async batch(statements: KeyValSqlStatement[]): Promise<void> {
    if (statements.length === 0) {
      return;
    }

    await this.service.transaction(
      {
        namespace: this.namespace,
        type: containsDdl(statements) ? "exclusive" : "concurrent",
      },
      async (db) => {
        const tx = new TursoKeyValTransactionAdapter(db);

        for (const statement of statements) {
          await tx.execute(statement.sql, statement.args);
        }
      },
    );
  }

  async close(): Promise<void> {
    await this.onClose?.();
  }

  async execute<T = unknown>(sql: string, args?: unknown[]): Promise<T[]> {
    const db = await this.service.connect(this.namespace);
    const adapter = new TursoKeyValTransactionAdapter(db);
    return adapter.execute<T>(sql, args);
  }

  async executeOne<T = unknown>(sql: string, args?: unknown[]): Promise<T | null> {
    const db = await this.service.connect(this.namespace);
    const adapter = new TursoKeyValTransactionAdapter(db);
    return adapter.executeOne<T>(sql, args);
  }

  async transaction<T>(fn: (tx: KeyValTransactionAdapter) => Promise<T>): Promise<T> {
    return this.service.transaction({ namespace: this.namespace }, async (db) => {
      return fn(new TursoKeyValTransactionAdapter(db));
    });
  }
}
