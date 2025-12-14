import { join } from "node:path";
import { createStaticHandler } from "@buntime/shared/utils/static-handler";
import { api } from "./server/api";

// Path to dist/client directory (built by scripts/build.ts)
const clientDir = join(import.meta.dir, "dist/client");

// Worker entrypoint - Bun.serve format
export default {
  routes: {
    "/api/*": api.fetch,
  },
  fetch: createStaticHandler(clientDir),
};
