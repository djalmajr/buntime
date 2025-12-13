import server from "./app/server";
import client from "./app/client/index.html";

const PORT = 4002;

// Routes without /auth prefix (proxy strips it)
const app = Bun.serve({
  port: PORT,
  static: {
    "/": client,
    "/login": client,
  },
  routes: {
    "/api/*": server.fetch,
    "/api": server.fetch,
  },
  development: {
    console: true,
    hmr: true,
  },
});

console.log(`🔐 Auth dev server running at ${app.url}`);
