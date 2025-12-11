import { join } from "node:path";
import { createStaticHandler } from "@buntime/shared/utils/static-handler";

export default {
  fetch: createStaticHandler(join(import.meta.dir, "client")),
  onIdle() {
    console.log("[todo-mvc] idle");
  },
  onTerminate() {
    console.log("[todo-mvc] terminated");
  },
};
