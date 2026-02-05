# Shell Setup

Step-by-step guide to configure the micro-frontend shell in plugin-gateway.

## What You Will Build

```
┌─────────────────────────────────────────────────┐
│  Shell App (example-spa)                      │
│  ┌───────────────────────────────────────────┐  │
│  │  Header: Logo + User Menu                 │  │
│  └───────────────────────────────────────────┘  │
│  ┌──────┬────────────────────────────────────┐  │
│  │ Side │  <iframe src="/deployments">       │  │
│  │ bar  │    Deployments App                 │  │
│  │      │  </iframe>                         │  │
│  │ - D  │                                    │  │
│  │ - L  │  (App rendered inside)             │  │
│  │ - S  │                                    │  │
│  └──────┴────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## Prerequisites

- Buntime runtime running
- Plugin-gateway enabled
- Basic knowledge of React/Vue/Svelte

## Step 1: Create the Shell App

### File Structure

```bash
mkdir -p /data/apps/example-spa
cd /data/apps/example-spa
```

```
example-spa/
├── manifest.yaml        # Worker config + metadata
├── .env                 # Optional: environment variables
├── package.json
├── src/
│   ├── App.tsx          # Main component
│   ├── Layout.tsx       # Header + Sidebar + Content
│   ├── index.tsx        # Entry point
│   └── shell.ts         # Frame communication
└── dist/                # Build output
    ├── index.html
    └── assets/
```

### manifest.yaml

```yaml
name: "@buntime/example-spa"
base: "/"
visibility: public
entrypoint: dist/index.html
ttl: 300
idleTimeout: 60

publicRoutes:
  - "/"
  - "/assets/**"
  - "/deployments"
  - "/logs"
  - "/settings"
```

### package.json

```json
{
  "name": "@buntime/example-spa",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@zomme/frame": "^1.0.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.0.0",
    "vite": "^5.0.0"
  }
}
```

## Step 2: Implement the Shell

### src/App.tsx

```tsx
import { useEffect, useState } from "react";
import { createShell } from "@zomme/frame";
import Layout from "./Layout";

export default function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [shell] = useState(() => createShell());

  useEffect(() => {
    // Listen for frame navigations
    shell.on("navigate", (path: string) => {
      window.history.pushState({}, "", path);
      setCurrentPath(path);
    });

    // Browser navigation (back/forward)
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [shell]);

  return <Layout currentPath={currentPath} />;
}
```

### src/Layout.tsx

```tsx
import { useEffect, useRef } from "react";

interface LayoutProps {
  currentPath: string;
}

export default function Layout({ currentPath }: LayoutProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Extract basename from path
  const basename = currentPath.split("/")[1] || "dashboard";

  // Reload iframe when basename changes
  useEffect(() => {
    if (iframeRef.current) {
      iframeRef.current.src = `/${basename}`;
    }
  }, [basename]);

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-800 text-white">
        <div className="p-4">
          <h1 className="text-xl font-bold">Buntime</h1>
        </div>
        <nav className="mt-4">
          <a href="/dashboard" className="block px-4 py-2 hover:bg-gray-700">
            Dashboard
          </a>
          <a href="/deployments" className="block px-4 py-2 hover:bg-gray-700">
            Deployments
          </a>
          <a href="/logs" className="block px-4 py-2 hover:bg-gray-700">
            Logs
          </a>
          <a href="/settings" className="block px-4 py-2 hover:bg-gray-700">
            Settings
          </a>
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="h-16 bg-white border-b flex items-center px-6">
          <div className="flex-1">
            <h2 className="text-lg font-semibold capitalize">{basename}</h2>
          </div>
          <div>
            <button className="px-4 py-2 text-sm">User Menu</button>
          </div>
        </header>

        {/* Content (Iframe) */}
        <main className="flex-1 overflow-hidden">
          <iframe
            ref={iframeRef}
            src={`/${basename}`}
            className="w-full h-full border-0"
            title={basename}
          />
        </main>
      </div>
    </div>
  );
}
```

### src/index.tsx

```tsx
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
```

## Step 3: Build the Shell

```bash
cd /data/apps/example-spa
bun install
bun run build
```

Verify output:

```bash
ls -la dist/
# index.html
# assets/main-abc123.js
# assets/main-def456.css
```

## Step 4: Configure Gateway

### Via manifest.yaml

```yaml
# plugins/plugin-gateway/manifest.yaml
shellDir: /data/apps/example-spa
shellExcludes: cpanel,admin
```

### Via Environment Variables

```bash
# .env or docker-compose.yml
GATEWAY_SHELL_DIR=/data/apps/example-spa
GATEWAY_SHELL_EXCLUDES=cpanel,admin
```

### Kubernetes (Helm)

```bash
helm upgrade buntime ./charts/buntime \
  --set plugins.gateway.shellDir="/data/apps/example-spa" \
  --set plugins.gateway.shellExcludes="cpanel,admin"
```

## Step 5: Adapt Existing Apps

Apps inside the iframe need to communicate with the shell.

### Deployments App (inside iframe)

```tsx
import { useEffect } from "react";
import { createFrame } from "@zomme/frame";

export default function DeploymentsApp() {
  const [frame] = useState(() => createFrame());

  const handleNavigate = (path: string) => {
    // Notify shell to update URL
    frame.emit("navigate", path);
  };

  return (
    <div className="p-6">
      <h1>Deployments</h1>
      <button onClick={() => handleNavigate("/deployments/new")}>
        New Deployment
      </button>
    </div>
  );
}
```

## Step 6: Test

### Normal Navigation

```bash
# Should serve shell
curl http://localhost:8000/deployments \
  -H "Sec-Fetch-Dest: document" \
  -v

# Response: Shell HTML
```

### Shell Bypass

```bash
# cpanel should render directly (bypass)
curl http://localhost:8000/cpanel \
  -H "Sec-Fetch-Dest: document" \
  -v

# Response: CPanel HTML
```

### Browser

Open in browser:
```
http://localhost:8000/deployments
```

Verify:
- [ ] Shell loads (header + sidebar)
- [ ] Iframe loads deployments app
- [ ] Navigation updates URL
- [ ] Back/Forward work

## Advanced Configuration

### Per-User Bypass

Allow users to disable shell via cookie:

```javascript
// In browser (DevTools Console)
document.cookie = "GATEWAY_SHELL_EXCLUDES=deployments; path=/";

// Reload page
location.reload();
```

Now `/deployments` renders directly, without shell.

### Lazy Loading Apps

```tsx
// Shell: load iframe only when needed
const [loadedApps, setLoadedApps] = useState<Set<string>>(new Set());

useEffect(() => {
  if (!loadedApps.has(basename)) {
    setLoadedApps((prev) => new Set([...prev, basename]));
  }
}, [basename]);

// Render only loaded apps
{loadedApps.has("deployments") && (
  <iframe src="/deployments" style={{ display: basename === "deployments" ? "block" : "none" }} />
)}
```

### Preload Apps

```html
<!-- index.html -->
<link rel="preload" href="/deployments" as="document" />
<link rel="preload" href="/logs" as="document" />
```

### Loading States

```tsx
const [loading, setLoading] = useState(true);

<iframe
  src={`/${basename}`}
  onLoad={() => setLoading(false)}
/>

{loading && <div>Loading {basename}...</div>}
```

### Error Boundary

```tsx
import { ErrorBoundary } from "react-error-boundary";

<ErrorBoundary fallback={<ErrorFallback />}>
  <iframe src={`/${basename}`} />
</ErrorBoundary>
```

## Troubleshooting

### Shell does not load

**Problem:** Incorrect `GATEWAY_SHELL_DIR`

**Solution:**
```bash
# Verify path
ls -la /data/apps/example-spa

# Verify manifest
cat /data/apps/example-spa/manifest.yaml

# Verify build
ls -la /data/apps/example-spa/dist/
```

### Assets do not load

**Problem:** Incorrect base path

**Verify:**
```html
<!-- dist/index.html should have -->
<base href="/">
<script src="/assets/main.js"></script>

<!-- NOT -->
<script src="./assets/main.js"></script>
<script src="assets/main.js"></script>
```

### Iframe does not load app

**Problem:** CORS or CSP

**Solution:**
```yaml
# In app (deployments)
cors:
  origin: "*"
```

If using Content-Security-Policy:
```
Content-Security-Policy: frame-ancestors 'self'
```

### Navigation does not work

**Problem:** Shell ↔ frame communication broken

**Debug:**
```javascript
// In shell
console.log("Shell ready");
shell.on("navigate", (path) => {
  console.log("Navigate to:", path);
});

// In app (iframe)
console.log("Frame ready");
frame.emit("navigate", "/test");
```

### Bypass does not work

**Problem:** Invalid basename

**Solution:**
```yaml
# ✅ Valid
shellExcludes: cpanel,admin,my-app,my_app

# ❌ Invalid
shellExcludes: my.app,my app,my/app
```

## Next Steps

- [Shell Routing](../concepts/shell-routing.md) - Concepts
- [Configuration](configuration.md) - Complete reference
- [@zomme/frame](https://github.com/zommehq/frame) - Library documentation
