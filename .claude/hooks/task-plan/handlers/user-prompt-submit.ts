/**
 * User Prompt Submit Handler
 * Resolves active plan based on the user prompt context.
 */

import { ensureActivePlan } from "../core/auto-plan";
import type { ClaudeHookInput, ClaudeHookOutput, HandlerContext } from "../types";

export async function userPromptSubmit(
  ctx: HandlerContext,
  input: ClaudeHookInput,
): Promise<ClaudeHookOutput | void> {
  const { projectDir, config, client } = ctx;
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";

  if (!prompt) return;

  const ensured = ensureActivePlan(projectDir, config, {
    contextTitle: prompt,
  });

  const scoreText = typeof ensured.score === "number" ? ` | score=${ensured.score.toFixed(2)}` : "";
  const message =
    ensured.action === "created"
      ? `Task plan: created and activated "${ensured.plan.id}" (${ensured.reason})${scoreText}.`
      : `Task plan: reusing "${ensured.plan.id}" (${ensured.reason})${scoreText}.`;

  if (client) {
    await client.app.log({
      service: "task-plan",
      level: "info",
      message,
    });
  }

  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: `${message} Planning is automatic; no manual /plan-new required.`,
    },
  };
}
