import client from "~/index.html";

const PORT = 5001;

const app = Bun.serve({
  port: PORT,
  routes: {
    "/*": client,
  },
  development: {
    console: true,
    hmr: true,
  },
});

console.log(`🚀 Server running at ${app.url}`);
