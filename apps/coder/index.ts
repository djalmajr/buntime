import { createStaticHandler } from "@buntime/shared/utils/static-handler";
import { PORT } from "@/constants";
import server from "@/index";

export default {
  port: PORT,
  routes: { "/api/*": server.fetch },
  fetch: createStaticHandler(import.meta.dir),
} satisfies Parameters<typeof Bun.serve>[0];
