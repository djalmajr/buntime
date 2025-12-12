import { join } from "node:path";
import server from "./server";

const PORT = 5002;

const app = Bun.serve({
  port: PORT,
  routes: {
    "/api/*": server.fetch,
  },
  fetch: async (req: Request) => {
    const path = new URL(req.url).pathname;
    const name = path !== "/" ? path : "index.html";
    const file = Bun.file(join(import.meta.dir, "dist/client", name));

    if (await file.exists()) {
      return new Response(file, { headers: { "Content-Type": file.type } });
    }

    // SPA fallback
    const home = Bun.file(join(import.meta.dir, "dist/client", "index.html"));
    return new Response(home, { headers: { "Content-Type": home.type } });
  },
});

console.log(`Server running at ${app.url}`);
