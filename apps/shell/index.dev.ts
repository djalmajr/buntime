import client from "~/index.html";

// Dev server: serves the client with HMR. window.__config is not injected here
// (that happens in the worker's index.ts at the edge); for local dev the client
// falls back to PUBLIC_AUTH_CONFIG / shows a config-missing message. Run the
// platform app too if you want live /platform/api/config resolution.
const app = Bun.serve({
  development: { console: true, hmr: true },
  routes: { "/*": client },
});

console.log(`Shell dev server running at ${app.url}`);
