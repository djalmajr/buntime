import client from "./client/index.html";
import { api, routes } from "./server/api";

const PORT = 4002;

// Routes without /auth prefix (proxy strips it)
const app = Bun.serve({
  port: PORT,
  static: {
    "/": client,
    "/login": client,
  },
  routes: {
    "/api/*": api.fetch,
    "/session": routes.fetch,
    "/logout": routes.fetch,
  },
  development: {
    console: true,
    hmr: true,
  },
});

console.log(`🔐 Auth dev server running at ${app.url}`);
