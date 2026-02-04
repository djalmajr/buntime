/**
 * Bypass Handler
 * Activates one-time bypass flags for planning enforcer blocks
 */

import type { HandlerContext, BypassType } from "../types";
import { setBypass } from "../core/state";

const BYPASS_MESSAGES: Record<BypassType, string> = {
  plan: "⚠️ Bypass ativado. Próxima edição será permitida sem plano.",
  stop: "⚠️ Force stop ativado. Sessão pode ser encerrada.",
};

/**
 * Handle bypass command
 * Sets a one-time bypass flag that will be consumed on the next blocked operation
 */
export async function handleBypass(
  ctx: HandlerContext,
  type: BypassType
): Promise<string> {
  const { projectDir, config, client } = ctx;

  // Set the bypass flag
  setBypass(projectDir, config, type);

  const message = BYPASS_MESSAGES[type];

  // Log the bypass activation
  if (client) {
    await client.app.log({
      service: "task-plan",
      level: "warn",
      message,
    });
  }

  return message;
}
