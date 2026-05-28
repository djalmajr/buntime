import client from "~/index.html";
import server from "./server";

const app = Bun.serve({
  development: { console: true, hmr: true },
  routes: {
    "/api/*": server.fetch,
    "/*": client,
  },
});

console.log(`Platform dev server running at ${app.url}`);
