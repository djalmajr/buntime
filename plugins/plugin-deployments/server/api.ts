import { Hono } from "hono";
import { getDeploymentFile, listDeployments } from "./services";

// API routes with basePath
export const api = new Hono()
  .basePath("/api/deployments")
  .get("/", async (ctx) => {
    const path = ctx.req.query("path") || "";
    const deployments = await listDeployments(path);
    return ctx.json({ deployments, path });
  })
  .get("/download", async (ctx) => {
    const path = ctx.req.query("path");
    if (!path) {
      return ctx.json({ error: "Path required" }, 400);
    }

    const file = getDeploymentFile(path);

    if (!(await file.exists())) {
      return ctx.json({ error: "File not found" }, 404);
    }

    return new Response(file, {
      headers: {
        "Content-Disposition": `attachment; filename="${path.split("/").pop()}"`,
      },
    });
  });

export type DeploymentsRoutesType = typeof api;
