import { PORT } from "@/constants";
import server from "@/index";
import client from "~/index.html";

const app = Bun.serve({
  port: PORT,
  routes: {
    "/api/*": server.fetch,
    "/*": client,
  },
  development: {
    console: true,
    hmr: true,
  },
});

console.log(`🚀 Server running at ${app.url}`);
