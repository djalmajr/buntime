import { Hono } from "hono";

export default new Hono().get("/", (ctx) => {
  const appointments = Array.from({ length: 10 }, () => ({
    name: "Test User",
    email: "test@example.com",
    date: new Date().toISOString(),
  }));

  return ctx.json(appointments);
});
