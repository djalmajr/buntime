import { join } from "node:path";
import { createStaticHandler } from "@buntime/shared/utils/static-handler";

// Path to client directory (relative to dist/index.js, built by scripts/build.ts)
const clientDir = join(import.meta.dir, "client");

// Worker entrypoint - serves static client files only
// API routes (including SSE) run on main thread via plugin.ts routes
export default {
  fetch: createStaticHandler(clientDir),
};
