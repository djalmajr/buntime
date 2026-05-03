import { errorToResponse } from "@buntime/shared/errors";
import { Hono } from "hono";
import {
  compileRule,
  deleteRule,
  getAllRules,
  getDynamicRules,
  getLogger,
  getNextOrder,
  getRuleStorage,
  getStaticRules,
  type ProxyRule,
  ruleToResponse,
  ruleToStoredRule,
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
    const logger = getLogger();

    if (!getRuleStorage()) {
      return ctx.json({ error: "Dynamic rules not enabled (plugin-turso not configured)" }, 400);
    }

    const body = await ctx.req.json<Omit<ProxyRule, "id">>();

    if (!body.pattern || !body.target) {
      return ctx.json({ error: "pattern and target are required" }, 400);
    }

    const rule: StoredRule = {
      ...body,
      id: crypto.randomUUID(),
      order: getNextOrder(),
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

  // Reorder dynamic rules
  .put("/rules/reorder", async (ctx) => {
    const logger = getLogger();

    if (!getRuleStorage()) {
      return ctx.json({ error: "Dynamic rules not enabled" }, 400);
    }

    const { ids } = await ctx.req.json<{ ids: string[] }>();

    if (!Array.isArray(ids) || ids.length === 0) {
      return ctx.json({ error: "ids must be a non-empty array" }, 400);
    }

    const dynamicRules = getDynamicRules();
    const staticRules = getStaticRules();

    // Validate: no static rule IDs
    for (const id of ids) {
      if (staticRules.some((r) => r.id === id)) {
        return ctx.json({ error: `Cannot reorder static rule: ${id}` }, 403);
      }
    }

    // Validate: all IDs must exist in dynamic rules
    const dynamicIds = new Set(dynamicRules.map((r) => r.id));
    for (const id of ids) {
      if (!dynamicIds.has(id)) {
        return ctx.json({ error: `Rule not found: ${id}` }, 404);
      }
    }

    // Validate: must include all dynamic rule IDs
    if (ids.length !== dynamicRules.length) {
      return ctx.json({ error: "ids must include all dynamic rule IDs" }, 400);
    }

    // Build lookup for current rules
    const ruleMap = new Map(dynamicRules.map((r) => [r.id, r]));

    // Update order and save
    const reordered: typeof dynamicRules = [];
    for (let i = 0; i < ids.length; i++) {
      const rule = ruleMap.get(ids[i])!;
      const stored = ruleToStoredRule(rule);
      stored.order = i;
      await saveRule(stored);
      const compiled = compileRule(stored, false);
      if (compiled) reordered.push(compiled);
    }

    setDynamicRules(reordered);
    logger?.info(`Reordered ${ids.length} proxy rules`);
    return ctx.json(reordered.map(ruleToResponse));
  })

  // Update an existing dynamic rule
  .put("/rules/:id", async (ctx) => {
    const logger = getLogger();

    if (!getRuleStorage()) {
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
      base: body.base ?? existing.base,
      changeOrigin: body.changeOrigin ?? existing.changeOrigin,
      enabled: body.enabled ?? existing.enabled,
      headers: body.headers ?? existing.headers,
      id,
      name: body.name ?? existing.name,
      order: existing.order,
      pattern: body.pattern ?? existing.pattern,
      relativePaths: body.relativePaths ?? existing.relativePaths,
      rewrite: body.rewrite ?? existing.rewrite,
      secure: body.secure ?? existing.secure,
      target: body.target ?? existing.target,
      ws: body.ws ?? existing.ws,
      publicRoutes: body.publicRoutes ?? existing.publicRoutes,
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

  // Toggle enabled/disabled for a dynamic rule
  .patch("/rules/:id/toggle", async (ctx) => {
    const logger = getLogger();

    if (!getRuleStorage()) {
      return ctx.json({ error: "Dynamic rules not enabled" }, 400);
    }

    const { id } = ctx.req.param();
    const dynamicRules = getDynamicRules();
    const staticRules = getStaticRules();

    if (staticRules.some((r) => r.id === id)) {
      return ctx.json({ error: "Cannot toggle static rules" }, 403);
    }

    const index = dynamicRules.findIndex((r) => r.id === id);
    if (index === -1) {
      return ctx.json({ error: "Rule not found" }, 404);
    }

    const existing = dynamicRules[index]!;
    const stored = ruleToStoredRule(existing);
    stored.enabled = !existing.enabled;

    await saveRule(stored);
    const compiled = compileRule(stored, false);
    if (compiled) {
      dynamicRules[index] = compiled;
      setDynamicRules(dynamicRules);
    }

    logger?.info(
      `Toggled proxy rule "${stored.name || stored.id}" → ${stored.enabled ? "enabled" : "disabled"}`,
    );
    return ctx.json(ruleToResponse(compiled ?? existing));
  })

  // Delete a dynamic rule
  .delete("/rules/:id", async (ctx) => {
    const logger = getLogger();

    if (!getRuleStorage()) {
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
