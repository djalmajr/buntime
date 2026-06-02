---
title: Gateway
description: Buntime edge middleware — CORS, rate limiting (Token Bucket), micro-frontend shell, request logging, and real-time SSE monitoring.
sidebar:
  order: 2
---

Buntime edge middleware: CORS, rate limiting (Token Bucket), micro-frontend
shell, request logging, and real-time monitoring via SSE. Base route `/gateway`,
enabled by default.

:::note[Auth]
Admin endpoints live at `/gateway/admin/*` (stats, config, rate-limit, cache,
shell excludes, logs) and are gated by the runtime `X-API-Key` store via the
shared middleware. The data-plane hooks (`onRequest`/`onResponse` for live
traffic, rate-limit keying that reads `X-Identity`) are unaffected.
:::

## Overview

`plugin-gateway` is a runtime plugin (see [Plugin System](/concepts/plugin-system/))
that operates in the `onRequest`/`onResponse` pipeline, applying edge policies
before each request reaches the workers:

| Component        | Responsibility                                                         | File                     |
|------------------|------------------------------------------------------------------------|--------------------------|
| Rate Limiter     | Token Bucket per client (IP/user/custom), 429 when exhausted           | `server/rate-limit.ts`   |
| CORS Handler     | `OPTIONS` preflight + cross-origin response headers                    | `server/cors.ts`         |
| Shell Router     | Routes document navigations to a central micro-frontend shell          | `server/shell-bypass.ts` |
| Request Logger   | Ring buffer (100 entries) with filters and statistics                  | `server/request-log.ts`  |
| Persistence      | Metrics snapshots + shell excludes in `gateway_*` tables through `plugin-turso` | `server/persistence.ts`  |
| Response Cache   | In-memory LRU — **disabled by default** (config present but has no effect) | `server/cache.ts`    |

Execution order within `onRequest`:

1. **Shell routing** — if it is a document navigation and the basename is not in excludes, serve the shell.
2. **CORS preflight** — `OPTIONS` is answered with 204 + headers.
3. **Rate limit** — consumes 1 token; emits 429 with `Retry-After` if exhausted.
4. **Cache check** (disabled).

In `onResponse`, `Access-Control-Allow-*` and `Access-Control-Expose-Headers` headers are added.

The plugin base route is `/gateway` and the UI (React + TanStack Router) lives in `client/`.

## Configuration (manifest + env)

Configuration blends `manifest.yaml`, environment variables (override), and a cookie (shell bypass per user only). Environment variables always take precedence over YAML.

### Environment variables

| Variable                       | Type    | Default     | Description                                                   |
|--------------------------------|---------|-------------|---------------------------------------------------------------|
| `GATEWAY_SHELL_DIR`            | string  | `""`        | Absolute path to the shell app (empty = disabled)             |
| `GATEWAY_SHELL_EXCLUDES`       | string  | `"cpanel"`  | Basenames that skip the shell (CSV, not removable via API)    |
| `GATEWAY_RATE_LIMIT_REQUESTS`  | number  | `100`       | Bucket capacity (1–10000)                                     |
| `GATEWAY_RATE_LIMIT_WINDOW`    | string  | `"1m"`      | Window: `30s`, `1m`, `5m`, `15m`, `1h`                       |
| `GATEWAY_CORS_ORIGIN`          | string  | `"*"`       | Single origin or CSV                                          |
| `GATEWAY_CORS_CREDENTIALS`     | boolean | `false`     | Allow cookies/credentials cross-origin                        |

### Manifest (summary of top-level fields)

| Field                  | Type          | Default                                              | Notes                                           |
|------------------------|---------------|------------------------------------------------------|-------------------------------------------------|
| `shellDir`             | string        | `""`                                                 | Enables micro-frontend shell when set           |
| `shellExcludes`        | string (CSV)  | `"cpanel"`                                           | Bypass basenames                                |
| `rateLimit.requests`   | number        | `100`                                                | Bucket capacity                                 |
| `rateLimit.window`     | enum          | `"1m"`                                               | Refill window                                   |
| `rateLimit.keyBy`      | enum/function | `"ip"`                                               | `ip` \| `user` \| custom function in `plugin.ts` |
| `rateLimit.excludePaths` | string[]    | `[]`                                                 | Regex tested against the pathname               |
| `cors.origin`          | string \| string[] | `"*"`                                           | `"*"` forbidden with `credentials: true`        |
| `cors.methods`         | string[]      | `[GET, HEAD, PUT, PATCH, POST, DELETE]`              |                                                 |
| `cors.allowedHeaders`  | string[]      | `undefined`                                          | Added to simple headers                         |
| `cors.exposedHeaders`  | string[]      | `undefined`                                          | Headers exposed to browser JS                   |
| `cors.credentials`     | boolean       | `false`                                              | Requires a specific `origin`                    |
| `cors.maxAge`          | number        | `86400`                                              | Preflight cache (s)                             |
| `cors.preflight`       | boolean       | `true`                                               | Auto-respond to `OPTIONS`                       |
| `cache.*`              | object        | `null`                                               | Schema exists, **runtime disabled**             |

### Optional dependencies

Declared as `optionalDependencies` in the manifest:

- [`@buntime/plugin-turso`](/plugins/turso/) — enables persistence of metrics history and dynamic excludes.
- `@buntime/plugin-authn` (planned, see the [roadmap](/reference/roadmap/)) — required for `keyBy: user` (reads `X-Identity`).

### Storage direction

The gateway uses [`@buntime/plugin-turso`](/plugins/turso/) as its durable
persistence service for metrics history and dynamic shell excludes. Gateway
remains usable without Turso, but durable gateway state is only available when
Turso is loaded.

The storage architecture is direct Turso-backed storage through `@buntime/plugin-turso`:

- `@buntime/plugin-gateway` owns its `gateway_*` schema and metrics/excludes repository.
- The gateway manifest depends on `@buntime/plugin-turso` for durable SQL access, not on [`@buntime/plugin-keyval`](/plugins/keyval/).
- Do not route gateway storage through `plugin-keyval` as `gateway -> keyval -> turso`; KeyVal should be validated by its own tests and smoke flows, not by becoming mandatory gateway infrastructure.
- Turso Database is the only durable driver for gateway-owned state.
- `local` mode is acceptable for tests and single-pod deployments.
- `sync` mode is the Kubernetes target because each pod can keep its own local database file and synchronize with a remote sync server.
- `bun:sqlite` is not the default durable driver for this state because SQLite WAL still allows only one writer at a time.

See [Turso](/plugins/turso/) and [Storage](/concepts/storage/) for the cross-plugin decision.

## CORS

### Automatic preflight

When `cors.preflight: true` (default), `OPTIONS` returns `204 No Content` with headers computed from the request. Origins are validated against `cors.origin` (string, list, or `"*"`); the handler echoes the received `Origin` when it is allowed. `Access-Control-Allow-Headers` echoes whatever came in `Access-Control-Request-Headers`.

### Critical credentials rule

Browsers reject `Access-Control-Allow-Origin: *` when the request uses `credentials: 'include'`. Whenever `cors.credentials: true`, `cors.origin` must be a specific value (or list).

```yaml
# Wrong — browser blocks
cors: { origin: "*", credentials: true }

# Correct
cors: { origin: "https://app.example.com", credentials: true }
```

### Simple headers

Always allowed without `allowedHeaders`: `Accept`, `Accept-Language`, `Content-Language`, `Content-Type` (with simple values).
Always exposed without `exposedHeaders`: `Cache-Control`, `Content-Language`, `Content-Type`, `Expires`, `Last-Modified`, `Pragma`.

## Rate limiting

### Token Bucket algorithm

Each client has a bucket with capacity `requests`. The refill rate is `requests / windowSeconds` tokens/second, computed lazily on each call (no per-bucket timer). A request consumes 1 token; if `tokens < 1`, returns 429.

```text
refillRate = capacity / windowSeconds
# Example: 100 / 60 = 1.67 tokens/s
```

Cleanup removes inactive buckets every 60s. Memory is ~100 B/bucket (~1 MB for 10k active clients). The check itself is O(1).

### Identification strategies (`keyBy`)

| Value               | Generated key      | Header read                                          | Prerequisite         |
|---------------------|--------------------|------------------------------------------------------|----------------------|
| `"ip"` (default)    | `ip:<addr>`        | `X-Forwarded-For` (1st) → `X-Real-IP` → `"unknown"` | —                    |
| `"user"`            | `user:<sub>`       | `X-Identity` (JSON with `sub`)                       | `plugin-authn` (planned) |
| `(req) => string`   | function return    | any                                                  | configured in code   |

Custom functions can only be configured via `plugin.ts`, not via manifest:

```ts
export default gatewayPlugin({
  rateLimit: {
    requests: 5000,
    window: "1h",
    keyBy: (req) => `tenant:${req.headers.get("X-Tenant-Id") ?? "anon"}`,
  },
});
```

### Response headers

| Header                  | When                    | Value                                    |
|-------------------------|-------------------------|------------------------------------------|
| `X-RateLimit-Limit`     | always                  | bucket capacity                          |
| `X-RateLimit-Remaining` | always                  | remaining tokens                         |
| `X-RateLimit-Reset`     | 429 only                | ms timestamp when bucket is fully refilled |
| `Retry-After`           | 429 only                | seconds until next token                 |

### excludePaths

List of regexes tested against the full pathname. Useful for health checks and internal routes:

```yaml
rateLimit:
  excludePaths:
    - "/health"
    - "/_/api/health"
    - "/api/public/.*"
```

## Shell routing (micro-frontends)

### Concept

When `shellDir` is configured, **every document navigation** (`Sec-Fetch-Dest: document`) is served by the central app shell. The shell renders layout (header, sidebar) and loads the specific app inside an `<iframe>`. Apps in `shellExcludes` skip the shell and render directly.

### Request type detection

The `onRequest` shell branch fires when:

```ts
!isApiRoute && !shouldBypass && (isDocument || (isRootPath && !isFrameEmbedding))
//                                              ^ single path segment: !url.pathname.slice(1).includes("/")
```

So the shell worker is invoked not only for document navigations but also for **single-segment** asset paths:

| Request                       | `Sec-Fetch-Dest`            | Path shape         | Routed to shell worker?                       |
|-------------------------------|-----------------------------|--------------------|-----------------------------------------------|
| Document navigation           | `document`                  | any                | Yes (unless excluded)                         |
| Single-segment asset          | not `document`              | `/chunk-abc.js`    | **Yes** — shell worker serves the file        |
| Multi-segment asset           | not `document`              | `/assets/x.js`     | **No** — falls through to worker/proxy resolution |
| Frame embed                   | `iframe`, `embed`, `object` | single-segment     | No — bypass directly to the worker            |
| API route                     | —                           | `/_/api/*`, etc.   | No — always bypass                            |

API routes (`/_/api/*`, `/gateway/api/*`, etc.) always bypass.

:::caution[Gotcha — a shell app's build assets must live at single-segment paths]
Because the shell worker is only invoked for document navigations and
single-segment paths (`isRootPath`), an app served *as the shell* must emit its
assets at the root (`/chunk-abc.js`), **not** in a sub-directory (`/assets/…`,
`/workers/…`). A multi-segment asset request is never handed to the shell worker
— it falls through to normal app/proxy resolution and 404s (or, if a proxy rule
matches the prefix, is mis-routed upstream, e.g. a `^/api` rule swallowing
nothing but a generic `Unauthorized` leaking through). Bun's HTML bundler emits
flat root assets by default, so Bun-built shells work out of the box; bundlers
that nest under `/assets/` (Vite/CRA default) need their output flattened or the
asset moved to a single segment. **Seen in practice:** a SharedWorker bundled to
`/workers/session.worker.js` returned the runtime's error JSON instead of the
script because the gateway never routed it to the shell worker — moving the
build output to `/session.worker.js` (single segment) fixed it.
:::

### Exclude sources (merge)

| Source                             | Priority    | Restart? | Use case                             | Removable via API? |
|------------------------------------|-------------|----------|--------------------------------------|--------------------|
| `GATEWAY_SHELL_EXCLUDES` (env)     | base        | yes      | default excludes at deploy           | no                 |
| Turso (`gateway_shell_excludes`)   | additive    | no       | dynamic excludes via API             | yes                |
| Cookie `GATEWAY_SHELL_EXCLUDES`    | per-user    | no       | individual bypass in browser         | n/a (set/unset cookie) |

The final list is the union (no duplicates) of all three sources. Excludes are loaded from Turso into memory during plugin initialization and updated immediately after API mutations.

### Basename validation

Only `^[a-zA-Z0-9_-]+$`. Invalid basenames (with dot, space, slash) are rejected by the API and ignored during merge.

### `<base href>` injection

The shell always serves from `/`, but is mounted at any pathname. The gateway adds `x-base: /` to the request, and the shell worker injects `<base href="/">` into the HTML so that relative assets resolve correctly.

### Full flow (summary)

```text
GET /deployments/list  (Sec-Fetch-Dest: document)
  → gateway: basename "deployments" not in excludes
  → serve shell HTML
  → shell JS reads pathname → <iframe src="/deployments">
  → GET /deployments  (Sec-Fetch-Dest: iframe)
  → gateway: automatic bypass → deployments app worker
```

Shell-to-frame communication uses [`@zomme/frame`](https://github.com/djalmajr/frame) over `MessageChannel`. See also [Micro-frontend](/concepts/micro-frontend/).

### Minimal shell app structure

```yaml
# /data/apps/example-spa/manifest.yaml
name: "@buntime/example-spa"
base: "/"
visibility: public
entrypoint: dist/index.html
publicRoutes:
  - "/"
  - "/assets/**"
```

React implementation details (Layout/iframe/navigation) are out of scope for this page — they are generic micro-frontend patterns.

## API Reference

All routes mounted at `/gateway/api/*`. No auth by default (protect via `publicRoutes`).

### Monitoring and configuration

| Method | Path                | Description                                                              |
|--------|---------------------|--------------------------------------------------------------------------|
| GET    | `/sse`              | Server-Sent Events, snapshot every 1s (metrics, config, recent logs)     |
| GET    | `/stats`            | Full snapshot: rateLimit, cors, cache, shell, logs                       |
| GET    | `/config`           | Read-only resolved configuration (manifest + env)                        |

### Rate limiting

| Method | Path                              | Description                                                   | 400 error if RL disabled |
|--------|-----------------------------------|---------------------------------------------------------------|--------------------------|
| GET    | `/rate-limit/metrics`             | Aggregated totals + bucket config                             | yes                      |
| GET    | `/rate-limit/buckets?limit&sortBy` | List active buckets (sortBy: `tokens` \| `lastActivity`)     | yes                      |
| DELETE | `/rate-limit/buckets/:key`        | Reset a single bucket (key URL-encoded)                       | yes                      |
| POST   | `/rate-limit/clear`               | Reset all buckets, returns `{cleared: N}`                     | yes                      |

### Request logs

| Method | Path                | Description                                                                           |
|--------|---------------------|---------------------------------------------------------------------------------------|
| GET    | `/logs`             | Filters: `limit` (default 50), `ip`, `rateLimited` (bool), `statusRange` (4 → 4xx)   |
| DELETE | `/logs`             | Clears the ring buffer                                                                |
| GET    | `/logs/stats`       | `total`, `rateLimited`, `byStatus`, `avgDuration` (ms)                               |

Each entry: `{ id, timestamp, ip, method, path, status, duration, rateLimited }`.

### Metrics history (requires `plugin-turso`)

| Method | Path                          | Description                                                   |
|--------|-------------------------------|---------------------------------------------------------------|
| GET    | `/metrics/history?limit`      | 1s snapshots, up to 3600 entries (1h). Default `limit=60`     |
| DELETE | `/metrics/history`            | Clears all history                                            |

### Shell excludes

| Method | Path                              | Description                                                         | 400 errors                  |
|--------|-----------------------------------|---------------------------------------------------------------------|-----------------------------|
| GET    | `/shell/excludes`                 | Combined list `[{basename, source: env\|turso, addedAt?}]`          | shell not configured        |
| POST   | `/shell/excludes`                 | Body `{basename}` → writes `gateway_shell_excludes` through `plugin-turso` | invalid basename / already in env / shell not configured |
| DELETE | `/shell/excludes/:basename`       | Removes only dynamic excludes                                       | "Cannot remove environment-based exclude" |

### Cache (legacy, currently disabled)

| Method | Path                       | Description                                                           |
|--------|----------------------------|-----------------------------------------------------------------------|
| POST   | `/cache/invalidate`        | Body `{key}` or `{pattern}` or `{}`. Always returns 400 today         |

### SSE example (client)

```js
const es = new EventSource("/gateway/api/sse");
es.onmessage = (e) => {
  const { rateLimit, recentLogs } = JSON.parse(e.data);
  console.log("active buckets:", rateLimit?.metrics.activeBuckets);
};
```

## Persistence via plugin-turso

The gateway persists durable state through [`@buntime/plugin-turso`](/plugins/turso/),
owning its own `gateway_*` tables:

| Resource              | Storage                       | Format                                       | Volume          |
|-----------------------|-------------------------------|----------------------------------------------|-----------------|
| Metrics history       | `gateway_metrics_history`     | snapshots `{timestamp, totalRequests, blockedRequests, allowedRequests, activeBuckets}` | up to 3600 (1h) with cleanup |
| Dynamic excludes      | `gateway_shell_excludes`      | one row per dynamic basename                 | —               |

Without Turso, the gateway works normally — it only loses history after restart
and excludes are limited to env+cookie. Persistent gateway state does not depend
on KeyVal: gateway owns its schema directly on top of the Turso service.

## Integration with other plugins

| Plugin                                       | Type       | Role                                                          |
|----------------------------------------------|------------|---------------------------------------------------------------|
| [`@buntime/plugin-turso`](/plugins/turso/)   | optional dependency | Durable SQL provider for `gateway_*` tables |
| `@buntime/plugin-authn` (planned)            | optional   | Required for `rateLimit.keyBy: user` (reads `X-Identity.sub`) |

The pipeline and lifecycle (`onInit`, `onRequest`, `onResponse`, `onShutdown`)
follow the general contract described in the [Plugin System](/concepts/plugin-system/).

## Quick guides

### Minimal configuration per scenario

| Scenario               | `cors.origin`                      | `cors.credentials` | `rateLimit`                                          | Shell                      |
|------------------------|------------------------------------|--------------------|------------------------------------------------------|----------------------------|
| Local dev              | `"*"`                              | `false`            | `1000/1m` per IP                                     | disabled                   |
| Public API             | `"*"`                              | `false`            | `1000/1m` per IP, exclude `/api/public/.*`           | disabled                   |
| SPA + API (prod)       | `"https://app.example.com"`        | `true`             | `60/1m` per user                                     | `example-spa`, `cpanel` excluded |
| Multi-tenant           | list of hosts                      | `true`             | `5000/1h` per user (or custom function per tenant)   | shell + legacy excludes    |

### Shell setup (essential steps)

1. Build the shell app (any framework) with `entrypoint: dist/index.html` and `base: "/"` in the manifest.
2. Set `shellDir: /data/apps/<name>` and `shellExcludes` in plugin-gateway.
3. In the shell, derive the basename from `window.location.pathname` and render `<iframe src="/${basename}">`.
4. Ensure shell assets use absolute paths (the gateway injects `<base href="/">`).
5. Apps inside iframes can use `@zomme/frame` to emit navigation events to the shell.

Per-user override during development:

```js
document.cookie = "GATEWAY_SHELL_EXCLUDES=deployments; path=/";
location.reload();
```

## Troubleshooting

| Symptom                                                                  | Likely cause                                                  | Fix                                                                |
|--------------------------------------------------------------------------|---------------------------------------------------------------|--------------------------------------------------------------------|
| Browser: `No 'Access-Control-Allow-Origin' header is present`            | Origin not allowed                                            | Add the origin to `cors.origin`                                    |
| Browser: `wildcard '*' ... credentials mode is 'include'`                | `credentials: true` with `origin: "*"`                        | Replace `*` with a specific origin                                 |
| Browser: `Request header field X is not allowed`                         | Custom header outside `allowedHeaders`                        | Add `X` to `cors.allowedHeaders`                                   |
| Unexpected 429 on healthcheck                                            | `/health` not in `excludePaths`                               | Add pattern to `rateLimit.excludePaths`                            |
| Shell does not load                                                      | `GATEWAY_SHELL_DIR` points to invalid path or missing `dist/` | Check `ls $GATEWAY_SHELL_DIR/dist/index.html`                      |
| Shell assets 404 (e.g. `/deployments/assets/main.js`)                    | HTML uses relative paths without `<base>`                     | Ensure build uses absolute paths; gateway injects `<base href="/">` automatically |
| App in iframe does not load                                              | CORS/CSP blocking                                             | `cors.origin: "*"` on the app + `frame-ancestors 'self'` if CSP is present |
| Shell bypass via `shellExcludes` does not work                           | Invalid basename (characters outside `[a-zA-Z0-9_-]`)        | Use only alphanumeric, `-`, `_`                                    |
| `DELETE /shell/excludes/:basename` returns 400                           | Attempting to remove an env-sourced exclude                   | Remove via `GATEWAY_SHELL_EXCLUDES` (requires restart)             |
| `keyBy: user` does not rate-limit per user                               | `plugin-authn` (planned) missing, `X-Identity` not reaching gateway | See the [roadmap](/reference/roadmap/)                       |
| `/metrics/history` empty                                                 | `plugin-turso` missing or not configured                      | Enable [`plugin-turso`](/plugins/turso/) with durable storage      |

### Debug logs

Setting `RUNTIME_LOG_LEVEL=debug`:

```text
[gateway] Rate limiting: 100 requests per 1m
[gateway] Rate limited: ip:192.168.1.1
[gateway] CORS enabled: origin="*"
[gateway] Micro-frontend shell: /data/apps/example-spa
[gateway] Shell bypass basenames: cpanel, admin
[gateway] Shell serving: /deployments (dest: document)
[gateway] Shell bypassed: /cpanel
```
