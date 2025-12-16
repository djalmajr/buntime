import { errorToResponse } from "@buntime/shared/errors";
import { Hono } from "hono";
import {
  compileRule,
  deleteRule,
  getAllRules,
  getDynamicRules,
  getKv,
  getLogger,
  getStaticRules,
  type ProxyRule,
  ruleToResponse,
  type StoredRule,
  saveRule,
  setDynamicRules,
} from "./services";

export const api = new Hono()
  .basePath("/api")
  // List all rules (static + dynamic)
  .get("/rules", (ctx) => {
    const rules = getAllRules().map(ruleToResponse);
    return ctx.json(rules);
  })

  // List only rules with fragment configuration (for piercing)
  .get("/fragments", (ctx) => {
    const fragments = getAllRules()
      .filter((r) => r.fragment)
      .map((r) => ({
        allowMessageBus: r.fragment?.allowMessageBus ?? true,
        base: r.base,
        id: r.id,
        name: r.name,
        origin: r.target,
        pattern: r.pattern,
        preloadStyles: r.fragment?.preloadStyles,
        sandbox: r.fragment?.sandbox ?? "patch",
      }));
    return ctx.json(fragments);
  })

  // Get a single rule by ID
  .get("/rules/:id", (ctx) => {
    const { id } = ctx.req.param();
    const rule = getAllRules().find((r) => r.id === id);

    if (!rule) {
      return ctx.json({ error: "Rule not found" }, 404);
    }

    return ctx.json(ruleToResponse(rule));
  })

  // Create a new dynamic rule
  .post("/rules", async (ctx) => {
    const kv = getKv();
    const logger = getLogger();

    if (!kv) {
      return ctx.json({ error: "Dynamic rules not enabled (plugin-keyval not configured)" }, 400);
    }

    const body = await ctx.req.json<Omit<ProxyRule, "id">>();

    if (!body.pattern || !body.target) {
      return ctx.json({ error: "pattern and target are required" }, 400);
    }

    const rule: StoredRule = {
      ...body,
      id: crypto.randomUUID(),
    };

    // Validate pattern compiles
    const compiled = compileRule(rule, false);
    if (!compiled) {
      return ctx.json({ error: "Invalid regex pattern" }, 400);
    }

    await saveRule(rule);
    const dynamicRules = getDynamicRules();
    dynamicRules.push(compiled);
    setDynamicRules(dynamicRules);

    logger?.info(`Created proxy rule: ${rule.pattern} -> ${rule.target}`);
    return ctx.json(ruleToResponse(compiled), 201);
  })

  // Update an existing dynamic rule
  .put("/rules/:id", async (ctx) => {
    const kv = getKv();
    const logger = getLogger();

    if (!kv) {
      return ctx.json({ error: "Dynamic rules not enabled" }, 400);
    }

    const { id } = ctx.req.param();
    const dynamicRules = getDynamicRules();
    const staticRules = getStaticRules();
    const existingIndex = dynamicRules.findIndex((r) => r.id === id);

    // Check if it's a static rule
    if (staticRules.some((r) => r.id === id)) {
      return ctx.json({ error: "Cannot modify static rules" }, 403);
    }

    if (existingIndex === -1) {
      return ctx.json({ error: "Rule not found" }, 404);
    }

    const body = await ctx.req.json<Partial<ProxyRule>>();
    const existing = dynamicRules[existingIndex]!;

    const updated: StoredRule = {
      changeOrigin: body.changeOrigin ?? existing.changeOrigin,
      headers: body.headers ?? existing.headers,
      id,
      name: body.name ?? existing.name,
      pattern: body.pattern ?? existing.pattern,
      rewrite: body.rewrite ?? existing.rewrite,
      secure: body.secure ?? existing.secure,
      target: body.target ?? existing.target,
      ws: body.ws ?? existing.ws,
    };

    // Validate pattern compiles
    const compiled = compileRule(updated, false);
    if (!compiled) {
      return ctx.json({ error: "Invalid regex pattern" }, 400);
    }

    await saveRule(updated);
    dynamicRules[existingIndex] = compiled;
    setDynamicRules(dynamicRules);

    logger?.info(`Updated proxy rule: ${updated.pattern} -> ${updated.target}`);
    return ctx.json(ruleToResponse(compiled));
  })

  // Delete a dynamic rule
  .delete("/rules/:id", async (ctx) => {
    const kv = getKv();
    const logger = getLogger();

    if (!kv) {
      return ctx.json({ error: "Dynamic rules not enabled" }, 400);
    }

    const { id } = ctx.req.param();
    const staticRules = getStaticRules();
    const dynamicRules = getDynamicRules();

    // Check if it's a static rule
    if (staticRules.some((r) => r.id === id)) {
      return ctx.json({ error: "Cannot delete static rules" }, 403);
    }

    const index = dynamicRules.findIndex((r) => r.id === id);
    if (index === -1) {
      return ctx.json({ error: "Rule not found" }, 404);
    }

    await deleteRule(id);
    dynamicRules.splice(index, 1);
    setDynamicRules(dynamicRules);

    logger?.info(`Deleted proxy rule: ${id}`);
    return ctx.json({ success: true });
  })
  .onError((err) => {
    console.error("[Proxy] Error:", err);
    return errorToResponse(err);
  });

export type ProxyRoutesType = typeof api;
