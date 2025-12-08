import { join } from "node:path";
import { PORT } from "@/constants";
import server from "@/index";

const app = Bun.serve({
  port: PORT,
  routes: {
    "/api/*": server.fetch,
    "/*": async (req: Bun.BunRequest) => {
      const path = new URL(req.url).pathname;
      const name = path !== "/" ? path : "index.html";
      const file = Bun.file(join(import.meta.dir, "client", name));

      if (await file.exists()) {
        return new Response(file, { headers: { "Content-Type": file.type } });
      }

      const home = Bun.file(join(import.meta.dir, "client", "index.html"));
      return new Response(home, { headers: { "Content-Type": home.type } });
    },
  },
});

console.log(`Server running at ${app.url}`);
