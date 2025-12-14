import { join } from "node:path";
import { createStaticHandler } from "@buntime/shared/utils/static-handler";
import { api, routes } from "./server/api";

const clientDir = join(import.meta.dir, "dist/client");

export default {
  routes: {
    "/api/*": api.fetch,
    "/session": routes.fetch,
    "/logout": routes.fetch,
  },
  fetch: createStaticHandler(clientDir),
};
