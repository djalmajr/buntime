import { createStaticHandler } from "@buntime/shared/utils/static-handler";
import { app } from "./server";

export default {
  routes: { "/api/*": app.fetch },
  fetch: createStaticHandler(import.meta.dir),
};
