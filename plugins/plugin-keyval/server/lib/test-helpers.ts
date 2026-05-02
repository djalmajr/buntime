import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibSqlAdapter } from "@buntime/plugin-database";

/**
 * Default libSQL URL for integration tests.
 * Uses environment variable or an isolated local file database.
 */
export const LIBSQL_URL = process.env.LIBSQL_URL_0;

class TestLibSqlAdapter extends LibSqlAdapter {
  constructor(
    private readonly testDir: string,
    url: string,
  ) {
    super({ type: "libsql", urls: [url] });
  }

  override async close(): Promise<void> {
    await super.close();
    rmSync(this.testDir, { force: true, recursive: true });
  }
}

/**
 * Creates a LibSqlAdapter for integration tests.
 * Uses one isolated database per adapter when LIBSQL_URL_0 is not set.
 */
export function createTestAdapter(): LibSqlAdapter {
  if (LIBSQL_URL) {
    return new LibSqlAdapter({ type: "libsql", urls: [LIBSQL_URL] });
  }

  const testDir = mkdtempSync(join(tmpdir(), "buntime-keyval-"));
  return new TestLibSqlAdapter(testDir, `file:${join(testDir, "test.db")}`);
}
