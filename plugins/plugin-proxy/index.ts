import { join } from "node:path";
import { createStaticHandler } from "@buntime/shared/utils/static-handler";

// Worker entrypoint - serves static client files only
// API routes run on main thread via plugin.ts routes (requires persistent state for WebSocket proxying)

const clientDir = join(import.meta.dir, "client");

export default {
  fetch: createStaticHandler(clientDir),
};
