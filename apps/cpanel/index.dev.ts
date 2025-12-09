import { PORT } from "~/constants";
import client from "~/index.html";

const server = Bun.serve({
  development: true,
  port: PORT,
  routes: {
    "/*": client,
  },
});

console.log(`Server running at ${server.url}`);
