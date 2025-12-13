import { join } from "node:path";
import { createStaticHandler } from "@buntime/shared/utils/static-handler";
import { api } from "./server/api";

export default {
  routes: { "/api/*": api.fetch },
  fetch: createStaticHandler(join(import.meta.dir, "client")),
  onIdle() {
    console.log("[todos-kv] idle");
  },
  onTerminate() {
    console.log("[todos-kv] terminated");
  },
};
