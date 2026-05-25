import { describe, expect, it, mock } from "bun:test";
import type { TursoDatabase, TursoService } from "@buntime/plugin-turso";
import type { PluginContext } from "@buntime/shared/types";
import gatewayPlugin from "./plugin";

function createMockDatabase(): TursoDatabase {
  return {
    checkpoint: mock(async () => {}),
    close: mock(async () => {}),
    exec: mock(async () => {}),
    getRawClient: mock(() => ({})),
    getSyncStats: mock(async () => null),
    localPath: ":memory:",
    mode: "local",
    prepare: mock(() => ({
      all: mock(async () => []),
      get: mock(async () => null),
      run: mock(async () => ({ changes: 1, lastInsertRowid: 1 })),
    })),
    pull: mock(async () => false),
    push: mock(async () => {}),
    transaction: mock(async (callback) => callback(createMockDatabase())),
  } as unknown as TursoDatabase;
}

function createMockTurso(db: TursoDatabase): TursoService {
  return {
    close: mock(async () => {}),
    connect: mock(async () => db),
    health: mock(async () => ({
      connected: true,
      localPath: ":memory:",
      mode: "local",
      namespaces: ["gateway"],
      ok: true,
      sync: { enabled: false },
    })),
    transaction: mock(async (_options, callback) => callback(db)),
  };
}

function createMockContext(turso?: TursoService): PluginContext {
  const getPlugin = mock((pluginName: string) => {
    if (pluginName === "@buntime/plugin-turso") {
      return turso;
    }

    return undefined;
  }) as unknown as PluginContext["getPlugin"];

  return {
    config: {},
    getPlugin,
    globalConfig: {
      poolSize: 10,
      workerDirs: ["./apps"],
    },
    logger: {
      debug: mock(() => {}),
      error: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
    },
    runtime: {
      api: "/api",
      version: "test",
    },
  };
}

describe("gatewayPlugin", () => {
  it("initializes persistence from plugin-turso", async () => {
    const db = createMockDatabase();
    const turso = createMockTurso(db);
    const ctx = createMockContext(turso);
    const plugin = gatewayPlugin();

    await plugin.onInit?.(ctx);

    expect(ctx.getPlugin).toHaveBeenCalledWith("@buntime/plugin-turso");
    expect(turso.connect).toHaveBeenCalledWith("gateway");
    expect(turso.transaction).toHaveBeenCalledWith(
      { namespace: "gateway", type: "exclusive" },
      expect.any(Function),
    );
    expect(ctx.logger.debug).toHaveBeenCalledWith("Gateway persistence initialized with Turso");
  });

  it("logs when plugin-turso is unavailable", async () => {
    const ctx = createMockContext();
    const plugin = gatewayPlugin();

    await plugin.onInit?.(ctx);

    expect(ctx.getPlugin).toHaveBeenCalledWith("@buntime/plugin-turso");
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      "Turso plugin not available, persistence disabled",
    );
  });
});
