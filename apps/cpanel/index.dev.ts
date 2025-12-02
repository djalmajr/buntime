import { BUNTIME_API, PORT } from "~/constants";
import { proxyTo } from "~/helpers/proxy";
import client from "~/index.html";

const server = Bun.serve({
  development: true,
  port: PORT,
  routes: {
    "/_/*": proxyTo(BUNTIME_API!),
    "/*": client,
  },
});

console.log(`Server running at ${server.url}`);
