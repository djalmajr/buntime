import client from "~/index.html";
import server from "./server";

const PORT = 5002;

const app = Bun.serve({
  development: { console: true, hmr: true },
  port: PORT,
  routes: {
    "/api/*": server.fetch,
    "/*": client,
  },
});

console.log(`Server running at ${app.url}`);
