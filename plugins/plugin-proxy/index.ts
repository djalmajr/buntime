import { join } from "node:path";
import { createStaticHandler } from "@buntime/shared/utils/static-handler";
import { api } from "./server/api";

const clientDir = join(import.meta.dir, "client");

export default {
  routes: {
    "/api/*": api.fetch,
  },
  fetch: createStaticHandler(clientDir),
};
