import { createStaticHandler } from "@buntime/shared/utils/static-handler";
import server from "./server";

export default {
  fetch: createStaticHandler(import.meta.dir),
  routes: { "/api/*": server.fetch },
};
