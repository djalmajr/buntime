import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTursoConfig, type TursoService, TursoServiceImpl } from "@buntime/plugin-turso";
import type { PluginLogger } from "@buntime/shared/types";
import { TursoKeyValAdapter } from "./sql-adapter.ts";

const TEST_LOGGER: PluginLogger = {
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
};

interface TestAdapterOptions {
  localPath: string;
  testDir: string;
}

export interface TestTursoServiceHandle {
  close(): Promise<void>;
  service: TursoService;
}

/**
 * Creates a Turso-backed adapter for integration tests.
 * Uses one isolated local database per adapter.
 */
export function createTestAdapter(): TursoKeyValAdapter {
  const handle = createTestTursoService();
  return new TursoKeyValAdapter({
    namespace: "keyval",
    service: handle.service,
    onClose: handle.close,
  });
}

export function createTestTursoService(): TestTursoServiceHandle {
  const testDir = mkdtempSync(join(tmpdir(), "buntime-keyval-"));
  return createTursoServiceHandle({
    localPath: join(testDir, "test.db"),
    testDir,
  });
}

function createTursoServiceHandle(options: TestAdapterOptions): TestTursoServiceHandle {
  const service = new TursoServiceImpl({
    config: resolveTursoConfig({ localPath: options.localPath }),
    logger: TEST_LOGGER,
  });

  return {
    async close(): Promise<void> {
      await service.close();
      rmSync(options.testDir, { force: true, recursive: true });
    },
    service,
  };
}
