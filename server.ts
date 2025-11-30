import app from "@/app";
import { PORT } from "@/constants";
import { pool } from "@/libs/pool";
import { proxy } from "@/libs/proxy";

const server = Bun.serve({
  fetch: app.fetch,
  port: PORT,
  websocket: proxy.websocketHandler,
});

proxy.setServer(server);

console.log(`Server running at ${server.url}`);

process.on("SIGINT", function () {
  console.log("\n[Main] Shutting down...");
  pool.shutdown();
  process.exit(0);
});
