import client from "~/index.html";
import { api } from "./server/api";

export default {
  routes: {
    "/api/*": api.fetch,
    "/*": client,
  },
  development: {
    console: true,
    hmr: true,
  },
} satisfies Parameters<typeof Bun.serve>[0];
