import client from "~/index.html";
import { api } from "./server/api";

const PORT = 5001;

const app = Bun.serve({
  port: PORT,
  routes: {
    "/api/*": api.fetch,
    "/api": api.fetch,
    "/*": client,
  },
  development: {
    console: true,
    hmr: true,
  },
});

console.log(`🚀 Server running at ${app.url}`);
