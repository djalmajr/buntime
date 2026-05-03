import type { PluginContext, PluginImpl } from "@buntime/shared/types";
import { resolveTursoConfig, TursoServiceImpl } from "./server/service.ts";
import type { TursoPluginConfig } from "./server/types.ts";

let service: TursoServiceImpl | null = null;

export default function tursoPlugin(config: TursoPluginConfig = {}): PluginImpl {
  return {
    provides: () => service,

    async onInit(ctx: PluginContext) {
      const resolvedConfig = resolveTursoConfig(config);

      service = new TursoServiceImpl({
        config: resolvedConfig,
        logger: ctx.logger,
      });

      await service.connect();

      ctx.logger.info(
        `Turso plugin initialized (mode: ${resolvedConfig.mode}, localPath: ${resolvedConfig.localPath})`,
      );
    },

    async onShutdown() {
      await service?.close();
      service = null;
    },
  };
}

export { TursoAdapter } from "./server/adapter.ts";
export { resolveTursoConfig, tursoPlugin, TursoServiceImpl };
export type {
  TursoBindValue,
  TursoDatabase,
  TursoHealth,
  TursoMode,
  TursoPluginConfig,
  TursoResolvedConfig,
  TursoResolvedSyncConfig,
  TursoRunResult,
  TursoService,
  TursoStatement,
  TursoSyncHealth,
  TursoSyncPluginConfig,
  TursoSyncStats,
  TursoTransactionOptions,
  TursoTransactionType,
} from "./server/types.ts";
