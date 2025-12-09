import { join } from "node:path";
import { PORT } from "~/constants";

export default {
  port: PORT,
  fetch: async (req: Bun.BunRequest) => {
    const path = new URL(req.url).pathname;
    const name = path !== "/" ? path : "index.html";
    const file = Bun.file(join(import.meta.dir, name));

    if (await file.exists()) {
      return new Response(file, { headers: { "Content-Type": file.type } });
    }

    const home = Bun.file(join(import.meta.dir, "index.html"));
    return new Response(home, { headers: { "Content-Type": home.type } });
  },
} satisfies Parameters<typeof Bun.serve>[0];
