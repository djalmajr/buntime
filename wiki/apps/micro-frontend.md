---
title: "Micro-Frontend Architecture"
audience: dev
sources:
  - apps/runtime/docs/micro-frontend-architecture.md
updated: 2026-05-02
tags: [runtime, micro-frontend, z-frame, iframe, shell]
status: stable
---

# Micro-Frontend Architecture

The CPanel (shell) hosts plugin UIs as isolated micro-frontends. Each plugin
with an HTML entrypoint becomes an independent worker embeddable via `<z-frame>`
(`@zomme/frame`). Communication happens over a bidirectional `MessageChannel`
on top of `postMessage`.

For how plugins declare their UI, see [Plugin System](./plugin-system.md). For
the worker pool that serves each iframe, see [Worker Pool](./worker-pool.md).

## Goals

| Goal | How |
|------|-----|
| Modularity | Each plugin delivers its own UI as a worker |
| Independence | Isolated build/deploy per plugin |
| Framework-agnostic | React, Solid, Qwik, Vue — any of them |
| Security isolation | Sandboxed iframes, no access to the shell DOM |
| Typed communication | MessageChannel + automatic serialization (props, events, RPC) |

## Topology

```
Buntime Runtime (port 8000)
├── Shell (CPanel)
│   ├── Layout, navigation
│   └── <z-frame> elements ──┐
└── Workers                  │
    ├── Deployments  ◄───────┤  MessageChannel
    ├── Metrics      ◄───────┤  (props sync, RPC, events)
    ├── Logs         ◄───────┤
    └── ...          ◄───────┘
```

## Packages

| Package | Role |
|---------|------|
| `@zomme/frame` | `<z-frame>` web component (shell side) and `frameSDK` (iframe side) |
| `@zomme/frame-react` | React bindings (`useFrameSDK`, `useRouteSync`) |

> [!NOTE]
> The `useFrameSDK` hook is also frequently implemented locally in each
> plugin to avoid an extra dependency.

## `<z-frame>` — Shell Side

Web component that loads an iframe and manages the `MessageChannel`.

```html
<z-frame
  name="deployments"
  base="/deployments"
  src="http://localhost:8000/deployments"
  pathname="/files"
  theme="dark"
></z-frame>
```

### Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `name` | string | Identifier (required) |
| `src` | string | App URL in the iframe (required) |
| `base` | string | Base path for routing (default: `/<name>`) |
| `pathname` | string | Initial path (default: `/`) |
| `sandbox` | string | iframe permissions |

### JavaScript API

```typescript
const frame = document.querySelector("z-frame");

// Dynamic props — automatically synced to the iframe
frame.theme = "dark";
frame.user = currentUser;
frame.apiUrl = "https://api.example.com";

// Emit events to the iframe
frame.emit("route-change", { path: "/settings" });

// RPC: call a function registered by the iframe
const stats = await frame.getStats();

// Listen to events coming from the iframe
frame.addEventListener("ready", () => {});
frame.addEventListener("navigate", (e) => router.push(e.detail.path));
```

## `frameSDK` — Iframe Side

```typescript
import { frameSDK } from "@zomme/frame/sdk";

await frameSDK.initialize();  // required before use

// Access props passed by the shell
console.log(frameSDK.props.base);   // "/deployments"
console.log(frameSDK.props.theme);  // "dark"

// Call functions passed by the shell (props that are functions)
await frameSDK.props.onSuccess({ status: "ok" });

// Emit events to the shell
frameSDK.emit("navigate", { path: "/settings" });

// Listen to events from the shell
frameSDK.on("route-change", ({ path }) => router.navigate(path));

// Register functions for the shell to call
frameSDK.register({
  refreshData: async () => loadData(),
  getStats: () => ({ count: 42 }),
});

// Watch for changes on specific props
frameSDK.watch(["theme"], (changes) => {
  if ("theme" in changes) {
    const [next, prev] = changes.theme;
    applyTheme(next);
  }
});
```

## React Bindings

```tsx
import { useFrameSDK, useRouteSync } from "@zomme/frame-react";

function App() {
  const { props, isReady } = useFrameSDK();

  // Sync route with shell
  useRouteSync({
    onRouteChange: (path) => router.navigate(path),
    getCurrentPath: () => router.currentPath,
  });

  if (!isReady) return <Loading />;

  return <h1>Theme: {props.theme}</h1>;
}
```

## Plugin with UI — Structure

```
plugins/plugin-deployments/
├── manifest.yaml              # entrypoint: dist/client/index.html
├── plugin.ts                  # Middleware in the main process
├── server/api.ts              # API (for serverless, goes into index.ts)
├── client/
│   ├── index.tsx              # React entry
│   ├── index.html             # Shell HTML
│   ├── utils/use-frame-sdk.ts # Local hook
│   └── components/
└── dist/
    ├── plugin.js
    └── client/index.html
```

### Manifest

```yaml
name: "@buntime/plugin-deployments"
base: "/deployments"
entrypoint: dist/client/index.html  # HTML → automatic SPA mode
menus:
  - title: Deployments
    icon: lucide:cloud-upload
    path: /deployments
```

> There is no longer a `fragment` field in the manifest. Plugins with an HTML
> `entrypoint` are automatically available as micro-frontends.

### Client entry point

```tsx
import { createRoot } from "react-dom/client";
import { frameSDK } from "@zomme/frame/sdk";

await frameSDK.initialize();
frameSDK.register({ refresh: () => window.location.reload() });
createRoot(document.getElementById("root")!).render(<DeploymentsPage />);
```

### Shell Integration (CPanel)

The CPanel wraps `<z-frame>` in a React component. Listening for the `navigate`
event from the iframe and propagating it via `window.history.pushState` keeps
the shell URL in sync with the plugin's internal navigation. Props
(`base`, `pathname`, `theme`) are passed as attributes/properties on `<z-frame>`
and automatically synced to the iframe via `PROPS_UPDATE`.

## Communication — Protocol

### Initialization Flow

```
Shell (z-frame)                Iframe                  frameSDK
     │ creates iframe (src)      │                         │
     │──────────────────────────▶ │                         │
     │                            │ load                    │
     │                            │ ──── frameSDK.initialize() ─▶
     │ postMessage(INIT, props,   │                         │
     │              [port2])      │                         │
     │──────────────────────────▶ │                         │
     │                            │ receives port2, props   │
     │                            │ ◀─── port.postMessage(READY) ──
     │ emit('ready')              │                         │
```

### Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `INIT` | Shell → Frame | Initial props + `MessagePort` |
| `READY` | Frame → Shell | Frame initialized |
| `PROPS_UPDATE` | Shell → Frame | Props update |
| `EVENT` | Shell → Frame | Custom event |
| `CUSTOM_EVENT` | Frame → Shell | Custom event |
| `FUNCTION_CALL` | Bidirectional | RPC call |
| `FUNCTION_RESPONSE` | Bidirectional | RPC return value |

### Functions as Props

Functions are automatically serialized — virtual proxy via RPC:

```typescript
// Shell: passes function as prop
frame.onSave = async (data) => {
  await api.save(data);
  return { success: true };
};

// Frame: calls transparently
const result = await frameSDK.props.onSave({ id: 123 });
console.log(result.success);  // true
```

### Registered Functions

```typescript
// Frame: registers
frameSDK.register("getStats", () => ({ users: 42 }));

// Shell: calls
const stats = await frame.getStats();
```

## Base Path Injection

The runtime injects `<base href="/plugin-name/">` into the HTML served to the
iframe. This lets the plugin's SPA router work as if it were at the root, while
correctly resolving relative paths:

```typescript
// client/index.tsx
function getApiBase(): string {
  // Before (piercing/Shadow DOM): complex getRootNode logic
  // Now (frame): simple
  const base = document.querySelector("base");
  return base?.getAttribute("href")?.replace(/\/$/, "") || "/plugin";

  // Or via SDK:
  return frameSDK.props.base;
}
```

The injection is done in `wrapper.ts` when it detects an HTML response plus the
`X-Base` header. The content is HTML-escaped to prevent XSS. See
[@buntime/runtime](./runtime.md) for details on the mechanism.

## Benefits and Limitations

### Benefits

| Benefit | How it happens |
|---------|----------------|
| Security isolation | Sandboxed iframe — no access to the shell DOM |
| Independent deploy | Plugin updated without rebuilding the runtime |
| Technology freedom | Each plugin chooses its framework |
| Typed communication | TypeScript for props/events via @zomme/frame |
| Lazy loading | Frames load on demand |
| Resilience | An error in one frame does not affect the shell |

### Limitations

- Each frame pays the overhead of a process + bundle.
- Shared global state requires the shell as a mediator.
- DevTools are more complex — open the frame in "Open frame in new tab" for
  isolated debugging.

## Migrating from `@buntime/piercing`

The old system used Shadow DOM with piercing. To migrate:

1. Remove the `fragment` section from `manifest.yaml`.
2. Replace imports of `@buntime/piercing` with `@zomme/frame` (or
   `@zomme/frame-react`).
3. Initialize the SDK: `await frameSDK.initialize()` in the client entry.
4. Replace Shadow DOM access with `useFrameSDK()` (or `frameSDK` directly).
5. Simplify `getApiBase()` to use `<base>` or `frameSDK.props.base`.

## Related Documentation

- [@buntime/runtime](./runtime.md) — `<base href>` injection, `X-Base`/`X-Not-Found` headers.
- [Plugin System](./plugin-system.md) — manifest with `entrypoint`, `menus`, `injectBase`.
- [Worker Pool](./worker-pool.md) — wrapper that serves the iframe HTML.
