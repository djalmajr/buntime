import { createStaticHandler } from "@buntime/shared/utils/static-handler";
import { PORT } from "~/constants";

export default {
  port: PORT,
  fetch: createStaticHandler(import.meta.dir),
} satisfies Parameters<typeof Bun.serve>[0];
