import { join } from "node:path";
import { createStaticHandler } from "@buntime/shared/utils/static-handler";

export default {
  fetch: createStaticHandler(join(import.meta.dir, "client")),
};
