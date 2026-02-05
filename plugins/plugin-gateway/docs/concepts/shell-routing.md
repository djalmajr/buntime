# Shell Routing

Routing system for micro-frontend architecture with a central shell.

## What is Shell Routing?

Shell Routing lets all browser navigations be served by a central shell, which then loads specific apps inside itself (via iframe or web components).

```
Browser Navigation
       ↓
┌──────────────────────────────────────┐
│           Shell App                  │
│  ┌────────────────────────────────┐  │
│  │  Navigation Bar                │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │  Sidebar                       │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │  <iframe src="/app1">          │  │  ← Specific app
│  │    App1 Content                │  │
│  │  </iframe>                     │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

## Why Use Shell?

### Advantages

1. **Unified Layout** - Shared navigation and sidebar
2. **Shared State** - Global context across apps
3. **Lazy Loading** - Apps loaded on demand
4. **Independent Deploy** - Each app can be deployed separately
5. **Isolation** - Apps running in iframes do not conflict

### Disadvantages

1. **Complexity** - Shell ↔ frame communication
2. **Performance** - Iframe overhead
3. **SEO** - Content in iframe is not indexed

## How It Works

### 1. Navigation Detection

The gateway detects document navigations via the `Sec-Fetch-Dest` header:

```typescript
const secFetchDest = req.headers.get("Sec-Fetch-Dest");
const isDocument = secFetchDest === "document";
```

**Document navigations:**
- Browser address bar
- Links (`<a href>`)
- Form submissions
- `window.location.href = ...`

**Not document navigations:**
- `fetch()` or `XMLHttpRequest`
- Assets (CSS, JS, images)
- Embedded iframes

### 2. Shell Serves the Page

If it is a document navigation, the gateway serves the shell:

```typescript
if (isDocument && !shouldBypass) {
  return pool.fetch(shell.dir, shell.config, req);
}
```

The shell returns its HTML with:
- Layout (header, sidebar, footer)
- JavaScript that loads the target app

### 3. App Loaded in Shell

The shell uses the pathname to determine which app to load:

```javascript
// In shell app
const pathname = window.location.pathname; // "/deployments/list"
const basename = pathname.split("/")[1];   // "deployments"

// Load app in iframe
<iframe src={`/${basename}`} />
```

### 4. Shell ↔ Frame Communication

Using `@zomme/frame` for communication via MessageChannel:

```typescript
// Shell
import { createShell } from "@zomme/frame";

const shell = createShell();
shell.on("navigate", (path) => {
  window.history.pushState({}, "", path);
});

// App (inside iframe)
import { createFrame } from "@zomme/frame";

const frame = createFrame();
frame.emit("navigate", "/deployments/list");
```

## Configuration

### Via manifest.yaml

```yaml
# shellDir: Absolute path to shell app
shellDir: /data/apps/example-spa

# shellExcludes: Basenames that do NOT use shell
shellExcludes: cpanel,admin,legacy
```

### Via Environment Variables

```bash
# Shell app path
GATEWAY_SHELL_DIR=/data/apps/example-spa

# Basenames that bypass shell (comma-separated)
GATEWAY_SHELL_EXCLUDES=cpanel,admin,legacy
```

### Via Cookie (Per-User)

Users can override excludes via cookie:

```javascript
// In browser
document.cookie = "GATEWAY_SHELL_EXCLUDES=deployments,logs; path=/";
```

**Merge:** Cookie values are combined with env excludes.

## Shell Bypass

### When Bypass is Applied

Bypass makes the app render directly, WITHOUT going through the shell:

```
GET /cpanel
   ↓ bypass ↓
CPanel App (direct)
```

### Bypass Rules

1. **Basename in `GATEWAY_SHELL_EXCLUDES` (env)**
2. **Basename in cookie `GATEWAY_SHELL_EXCLUDES`**

### Basename Extraction

```typescript
function extractBasename(pathname: string): string {
  // "/deployments/list" → "deployments"
  // "/admin/users/123" → "admin"
  // "/" → ""
  const segments = pathname.split("/").filter(Boolean);
  return segments[0] ?? "";
}
```

### Validation

Only valid basenames are accepted:

```typescript
const VALID_BASENAME_REGEX = /^[a-zA-Z0-9_-]+$/;
```

## Complete Flow

```
1. Browser: GET /deployments/list
   │
   ├─ Header: Sec-Fetch-Dest: document
   │
   ▼
2. Gateway: Is it document navigation?
   │
   ├─ Yes
   │
   ▼
3. Gateway: Basename = "deployments"
   │
   ├─ In excludes? (env or cookie)
   │
   ├─ No
   │
   ▼
4. Gateway: Serves shell app
   │
   ▼
5. Shell: HTML + JavaScript loaded
   │
   ▼
6. Shell JS: Detects pathname "/deployments/list"
   │
   ├─ Basename = "deployments"
   │
   ▼
7. Shell: <iframe src="/deployments" />
   │
   ▼
8. Iframe: GET /deployments
   │
   ├─ Sec-Fetch-Dest: iframe
   │
   ▼
9. Gateway: Not document, goes directly to worker
   │
   ▼
10. Worker: Deployments app rendered inside iframe
```

## Base Path Injection

The shell always serves from root (`/`), but may need to load assets with relative paths.

### Problem

```html
<!-- Shell at /deployments/list -->
<script src="assets/main.js"></script>
<!-- Browser requests: /deployments/list/assets/main.js ❌ -->
```

### Solution: <base href>

The gateway injects the `x-base` header:

```typescript
reqWithBase.headers.set("x-base", "/");
```

The shell worker detects and injects `<base>`:

```html
<!DOCTYPE html>
<html>
  <head>
    <base href="/">  <!-- Injected automatically -->
    <script src="assets/main.js"></script>
    <!-- Browser requests: /assets/main.js ✅ -->
  </head>
</html>
```

## Shell App Structure

```
example-spa/
├── manifest.yaml
├── buntime.yaml
├── dist/
│   ├── index.html       # Shell HTML
│   ├── assets/
│   │   ├── main.js      # Shell JavaScript
│   │   └── main.css     # Shell CSS
│   └── ...
└── package.json
```

**manifest.yaml:**
```yaml
name: "@buntime/example-spa"
base: "/"
visibility: public
```

**buntime.yaml:**
```yaml
entrypoint: dist/index.html
ttl: 300
publicRoutes:
  - "/"
  - "/assets/**"
```

## Examples

### Development: No Shell

```yaml
# manifest.yaml
# shellDir not defined - apps render directly
```

```
GET /deployments
   ↓
Deployments App (direct)
```

### Production: With Shell

```yaml
# manifest.yaml
shellDir: /data/apps/example-spa
shellExcludes: cpanel
```

```
GET /deployments
   ↓
Shell App
   ├─ Layout
   └─ <iframe src="/deployments">

GET /cpanel
   ↓ (bypass)
CPanel App (direct)
```

### Per-User Bypass

User wants to see deployments WITHOUT shell:

```javascript
// In browser
document.cookie = "GATEWAY_SHELL_EXCLUDES=deployments; path=/";
```

```
GET /deployments
   ↓ (bypass via cookie)
Deployments App (direct)
```

## API Routes

API routes always bypass the shell:

```typescript
const isApiRoute = url.pathname === apiPath || url.pathname.startsWith(`${apiPath}/`);

if (isApiRoute) {
  // Goes directly to route handler, bypasses shell
}
```

```
GET /_/api/workers
   ↓ (always bypass)
Runtime API (direct)

GET /gateway/api/stats
   ↓ (always bypass)
Gateway API (direct)
```

## Frame Embeddings

Internal iframes (not navigation) always bypass shell:

```typescript
const isFrameEmbedding =
  secFetchDest === "iframe" ||
  secFetchDest === "embed" ||
  secFetchDest === "object";

if (isFrameEmbedding) {
  // Goes directly to worker, bypasses shell
}
```

```html
<!-- Inside shell -->
<iframe src="/deployments">
   ↓ Sec-Fetch-Dest: iframe
   ↓ (automatic bypass)
Deployments App (direct in iframe)
</iframe>
```

## Root Path Assets

Root path assets served by shell:

```typescript
const isRootPath = !url.pathname.slice(1).includes("/");

if (isRootPath && !isFrameEmbedding) {
  // Shell serves: /main.js, /favicon.ico, etc
}
```

```
GET /main.js
   ↓ (root asset)
Shell App

GET /deployments/chunk.js
   ↓ (not root, goes to worker)
Deployments App
```

## Persistence with KeyVal

Shell excludes can be stored persistently in the KeyVal database, allowing management via API without requiring environment variable or container restarts.

### Storage Location

Shell excludes are stored in the KeyVal database under the key `gateway:shell:excludes` as a comma-separated string:

```
Key: gateway:shell:excludes
Value: "cpanel,admin,legacy"
```

### Environment vs Persisted Excludes

Both sources are merged at runtime:

| Source | Priority | Restart Required | Use Case |
|--------|----------|------------------|----------|
| `GATEWAY_SHELL_EXCLUDES` (env) | Base excludes | Yes | Default excludes defined at deployment |
| KeyVal database | Additional excludes | No | Dynamic excludes managed via API |
| Cookie | Per-user override | No | User-specific bypass |

**Merge behavior:**
```typescript
const envExcludes = ["cpanel"];                    // From environment
const dbExcludes = ["admin", "legacy"];             // From KeyVal
const cookieExcludes = ["deployments"];             // From user cookie

// Final merged list:
// ["cpanel", "admin", "legacy", "deployments"]
```

### API Endpoints for Management

#### Get Current Excludes

```bash
GET /gateway/api/shell/excludes

Response:
{
  "excludes": ["cpanel", "admin", "legacy"],
  "sources": {
    "env": ["cpanel"],
    "db": ["admin", "legacy"],
    "cookie": []
  }
}
```

#### Add Exclude

```bash
POST /gateway/api/shell/excludes
Content-Type: application/json

{
  "basename": "new-app"
}

Response:
{
  "success": true,
  "excludes": ["cpanel", "admin", "legacy", "new-app"]
}
```

#### Remove Exclude

```bash
DELETE /gateway/api/shell/excludes/:basename

Example:
DELETE /gateway/api/shell/excludes/admin

Response:
{
  "success": true,
  "excludes": ["cpanel", "legacy", "new-app"]
}
```

#### Replace All Excludes

```bash
PUT /gateway/api/shell/excludes
Content-Type: application/json

{
  "excludes": ["cpanel", "admin"]
}

Response:
{
  "success": true,
  "excludes": ["cpanel", "admin"]
}
```

### Implementation Details

**Reading excludes on each request:**

```typescript
async function getShellExcludes(ctx: PluginContext): Promise<string[]> {
  const envExcludes = parseExcludes(Bun.env.GATEWAY_SHELL_EXCLUDES);
  const dbExcludes = await getKeyValExcludes(ctx);

  return [...new Set([...envExcludes, ...dbExcludes])];
}

async function getKeyValExcludes(ctx: PluginContext): Promise<string[]> {
  const keyval = ctx.getService<KeyVal>("keyval");
  const value = await keyval?.get("gateway:shell:excludes");
  return value ? parseExcludes(value) : [];
}
```

**Storing excludes:**

```typescript
async function setKeyValExcludes(ctx: PluginContext, excludes: string[]) {
  const keyval = ctx.getService<KeyVal>("keyval");
  const value = excludes.join(",");
  await keyval?.set("gateway:shell:excludes", value);
}
```

### Caching Considerations

Shell excludes are read on **every document navigation request**. For high-traffic scenarios, consider implementing a short-lived cache:

```typescript
let excludesCache: { value: string[]; timestamp: number } | null = null;
const CACHE_TTL = 5000; // 5 seconds

async function getCachedExcludes(ctx: PluginContext): Promise<string[]> {
  const now = Date.now();

  if (excludesCache && now - excludesCache.timestamp < CACHE_TTL) {
    return excludesCache.value;
  }

  const excludes = await getShellExcludes(ctx);
  excludesCache = { value: excludes, timestamp: now };

  return excludes;
}
```

### Database Schema

The KeyVal plugin stores excludes in LibSQL:

```sql
CREATE TABLE IF NOT EXISTS keyval (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Example row
INSERT INTO keyval (key, value)
VALUES ('gateway:shell:excludes', 'cpanel,admin,legacy');
```

### Migration from Environment-Only

To migrate existing environment-based excludes to database:

```bash
# 1. Read current env excludes
curl http://localhost:8000/gateway/api/shell/excludes

# 2. Store in database
curl -X PUT http://localhost:8000/gateway/api/shell/excludes \
  -H "Content-Type: application/json" \
  -d '{"excludes": ["cpanel", "admin"]}'

# 3. (Optional) Remove from environment after verification
# Edit Helm values or docker-compose.yml to remove GATEWAY_SHELL_EXCLUDES
```

## Debugging

### Logs

When `RUNTIME_LOG_LEVEL=debug`:

```
[gateway] Micro-frontend shell: /data/apps/example-spa
[gateway] Shell bypass basenames: cpanel, admin
[gateway] Shell serving: /deployments (dest: document)
[gateway] Shell bypassed: /cpanel
```

### Headers

Verify request headers:

```bash
curl -v http://localhost:8000/deployments

< Sec-Fetch-Dest: document
< Sec-Fetch-Mode: navigate
```

### Cookie

View bypass cookie:

```javascript
console.log(document.cookie);
// "GATEWAY_SHELL_EXCLUDES=deployments,logs"
```

## Troubleshooting

### Shell does not load

**Problem:** Incorrect shell path

**Solution:**
```bash
# Verify path exists
ls -la /data/apps/example-spa

# Verify manifest
cat /data/apps/example-spa/manifest.yaml
```

### App does not load in iframe

**Problem:** CORS or frame-ancestors

**Solution:**
```yaml
# In app (inside iframe)
cors:
  origin: "*"

# If using CSP, allow frame-ancestors
# Content-Security-Policy: frame-ancestors 'self'
```

### Bypass does not work

**Problem:** Invalid basename

**Solution:**
```javascript
// Only alphanumeric characters, - and _
✅ "deployments"
✅ "my-app"
✅ "admin_panel"
❌ "my.app"       // dot not allowed
❌ "my app"       // space not allowed
❌ "my/app"       // slash not allowed
```

## Next Steps

- [Shell Setup](../guides/shell-setup.md) - Step-by-step setup
- [Rate Limiting](rate-limiting.md) - Rate limiting
- [CORS](cors.md) - CORS configuration
