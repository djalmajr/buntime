/**
 * Bypass Handler
 * Sets bypass flag for the next git operation
 */

import type { HandlerContext } from "../types";
import { setBypass } from "../db";

/**
 * Handle /bypass-git command
 */
export async function handleBypass(ctx: HandlerContext): Promise<string> {
  const { projectDir, client } = ctx;

  setBypass(projectDir);

  if (client) {
    await client.app.log({
      service: "git-guard",
      level: "info",
      message: "Git bypass flag set for next operation",
    });
  }

  return formatBypassResponse();
}

function formatBypassResponse(): string {
  return `
${"=".repeat(50)}
GIT GUARD - Bypass Enabled
${"=".repeat(50)}

Next git command will be allowed.
Bypass is consumed after first use.

Proceed with your git operation.
${"=".repeat(50)}
`.trim();
}
