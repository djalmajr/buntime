import { createStaticHandler } from "@buntime/shared/utils/static-handler";
import { Hono } from "hono";
import { authMiddleware } from "./server/middleware/auth";

const app = new Hono();

// Authentication middleware for all routes
app.use("*", authMiddleware);

// Serve static files (frontend) after passing through the middleware
// After build, import.meta.dir is already the dist folder
const staticHandler = createStaticHandler(import.meta.dir);

app.all("*", async (ctx) => {
  // Cast to BunRequest - static handler only uses url property
  return staticHandler(ctx.req.raw as unknown as Bun.BunRequest);
});

export default {
  fetch: app.fetch,
};
