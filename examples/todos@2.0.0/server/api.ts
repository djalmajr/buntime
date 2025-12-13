import { Kv } from "@buntime/keyval";
import { Hono } from "hono";

export interface Todo {
  completed: boolean;
  text: string;
  uid: string;
}

// Server-side requires absolute URL (BUNTIME_URL or default to localhost:8000)
const kvBaseUrl = `${Bun.env.BUNTIME_URL || "http://localhost:8000"}/api/keyval`;
const kv = new Kv(kvBaseUrl);

export const api = new Hono()
  .basePath("/api")
  // List all todos
  .get("/todos", async (ctx) => {
    const todos: Todo[] = [];
    for await (const entry of kv.list<Todo>(["todos"])) {
      if (entry.value) {
        todos.push(entry.value);
      }
    }
    return ctx.json(todos);
  })

  // Get single todo
  .get("/todos/:uid", async (ctx) => {
    const { uid } = ctx.req.param();
    const entry = await kv.get<Todo>(["todos", uid]);
    if (!entry.value) {
      return ctx.json({ error: "Todo not found" }, 404);
    }
    return ctx.json(entry.value);
  })

  // Create todo
  .post("/todos", async (ctx) => {
    const { text } = await ctx.req.json<{ text: string }>();
    const uid = crypto.randomUUID();
    const todo: Todo = { uid, text, completed: false };
    await kv.set(["todos", uid], todo);
    return ctx.json(todo, 201);
  })

  // Update todo
  .put("/todos/:uid", async (ctx) => {
    const { uid } = ctx.req.param();
    const updates = await ctx.req.json<Partial<Todo>>();

    const entry = await kv.get<Todo>(["todos", uid]);
    if (!entry.value) {
      return ctx.json({ error: "Todo not found" }, 404);
    }

    const updated = { ...entry.value, ...updates, uid };
    await kv.set(["todos", uid], updated);
    return ctx.json(updated);
  })

  // Delete todo
  .delete("/todos/:uid", async (ctx) => {
    const { uid } = ctx.req.param();
    await kv.delete(["todos", uid]);
    return ctx.json({ ok: true });
  })

  // Toggle all todos
  .post("/todos/toggle-all", async (ctx) => {
    const { completed } = await ctx.req.json<{ completed: boolean }>();
    const atomic = kv.atomic();
    const updated: Todo[] = [];

    for await (const entry of kv.list<Todo>(["todos"])) {
      if (entry.value) {
        const todo = { ...entry.value, completed };
        atomic.set(["todos", entry.value.uid], todo);
        updated.push(todo);
      }
    }

    await atomic.commit();
    return ctx.json(updated);
  })

  // Clear completed todos
  .post("/todos/clear-completed", async (ctx) => {
    const atomic = kv.atomic();
    const remaining: Todo[] = [];

    for await (const entry of kv.list<Todo>(["todos"])) {
      if (entry.value) {
        if (entry.value.completed) {
          atomic.delete(["todos", entry.value.uid]);
        } else {
          remaining.push(entry.value);
        }
      }
    }

    await atomic.commit();
    return ctx.json(remaining);
  });

export type ApiType = typeof api;
