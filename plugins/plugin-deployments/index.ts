import { join } from "node:path";
import { createStaticHandler } from "@buntime/shared/utils/static-handler";
import { api } from "./server/api";

// Path to client directory (relative to dist/index.js, built by scripts/build.ts)
const clientDir = join(import.meta.dir, "client");

// Worker entrypoint - Bun.serve format
export default {
  routes: {
    "/api/*": api.fetch,
  },
  fetch: createStaticHandler(clientDir),
};
