# API Reference

Complete reference for the plugin-gateway API.

## Base URL

All routes are served under the plugin base path:

```
/gateway/api/*
```

## Authentication

Gateway API routes **do NOT** require authentication by default, but can be protected via:

1. Authn plugin (if enabled)
2. `publicRoutes` configuration in manifest

## Endpoints

### GET /api/stats

Returns complete gateway statistics including rate limiting, CORS, cache, shell, and request logs.

#### Request

```http
GET /gateway/api/stats
```

#### Response

```json
{
  "rateLimit": {
    "enabled": true,
    "metrics": {
      "totalRequests": 1543,
      "blockedRequests": 42,
      "allowedRequests": 1501,
      "activeBuckets": 12,
      "config": {
        "capacity": 100,
        "windowSeconds": 60
      }
    },
    "config": {
      "requests": 100,
      "window": "1m",
      "keyBy": "ip"
    }
  },
  "cors": {
    "enabled": true,
    "config": {
      "origin": "*",
      "credentials": false,
      "methods": ["GET", "POST", "PUT", "DELETE"],
      "maxAge": 86400
    }
  },
  "cache": {
    "enabled": false
  },
  "shell": {
    "enabled": true,
    "dir": "/data/apps/example-spa",
    "excludesCount": 2
  },
  "logs": {
    "total": 1543,
    "rateLimited": 42,
    "byStatus": {
      "200": 1401,
      "404": 58,
      "429": 42,
      "500": 42
    },
    "avgDuration": 23.5
  }
}
```

**Status:** `200 OK`

**Fields:**
- `rateLimit`: Rate limiter state
  - `enabled`: Whether rate limiting is active
  - `metrics`: Current metrics (null if disabled)
  - `config`: Configuration (null if disabled)
- `cors`: CORS configuration state
  - `enabled`: Whether CORS is configured
  - `config`: CORS configuration (null if disabled)
- `cache`: Cache state (currently always disabled)
  - `enabled`: Whether cache is active
- `shell`: App shell configuration
  - `enabled`: Whether shell is configured
  - `dir`: Shell directory path
  - `excludesCount`: Number of excluded basenames
- `logs`: Request log statistics
  - `total`: Total requests logged
  - `rateLimited`: Number of rate-limited requests
  - `byStatus`: Request count by status code
  - `avgDuration`: Average request duration in milliseconds

#### Example

```bash
curl http://localhost:8000/gateway/api/stats
```

---

### GET /api/config

Returns read-only gateway configuration.

#### Request

```http
GET /gateway/api/config
```

#### Response

```json
{
  "rateLimit": {
    "requests": 100,
    "window": "1m",
    "keyBy": "ip",
    "excludePaths": ["/health", "/metrics"]
  },
  "cors": {
    "origin": "*",
    "credentials": false,
    "methods": ["GET", "POST", "PUT", "DELETE"],
    "allowedHeaders": ["Content-Type", "Authorization"],
    "exposedHeaders": ["X-Request-Id"],
    "maxAge": 86400,
    "preflight": true
  },
  "cache": null,
  "shell": {
    "dir": "/data/apps/example-spa",
    "envExcludes": ["cpanel", "admin"]
  }
}
```

**Status:** `200 OK`

#### Example

```bash
curl http://localhost:8000/gateway/api/config
```

---

### GET /api/sse

Server-Sent Events endpoint for real-time gateway updates.

Streams gateway state changes including metrics, logs, and configuration updates at regular intervals (default: 1 second).

#### Request

```http
GET /gateway/api/sse
Accept: text/event-stream
```

#### Response

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"timestamp":1706000000000,"rateLimit":{"metrics":{...},"config":{...}},"cors":{...},"shell":{...},"recentLogs":[...]}

data: {"timestamp":1706000001000,"rateLimit":{"metrics":{...},"config":{...}},"cors":{...},"shell":{...},"recentLogs":[...]}
```

**Status:** `200 OK`

**Event Data Fields:**
- `timestamp`: Current timestamp in milliseconds
- `rateLimit`: Rate limiting state (null if disabled)
  - `metrics`: Current metrics
  - `config`: Configuration
- `cors`: CORS configuration (null if disabled)
- `shell`: Shell configuration (null if disabled)
  - `enabled`: Whether shell is active
  - `dir`: Shell directory path
  - `excludes`: Array of excluded basenames with source
- `recentLogs`: Last 10 request log entries

#### Example

```bash
# Using curl
curl -N http://localhost:8000/gateway/api/sse
```

```javascript
// JavaScript EventSource
const eventSource = new EventSource("http://localhost:8000/gateway/api/sse");

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log("Gateway update:", data);
  console.log("Active buckets:", data.rateLimit?.metrics.activeBuckets);
  console.log("Recent logs:", data.recentLogs.length);
};

eventSource.onerror = (error) => {
  console.error("SSE error:", error);
  eventSource.close();
};
```

---

### GET /api/logs

Get request logs with optional filtering.

#### Request

```http
GET /gateway/api/logs?limit=50&ip=192.168.1.1&rateLimited=true&statusRange=4
```

**Query Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `limit` | `number` | Maximum number of entries to return | `50` |
| `ip` | `string` | Filter by client IP address | - |
| `rateLimited` | `boolean` | Filter only rate-limited requests | - |
| `statusRange` | `number` | Filter by status range (e.g., 4 for 4xx) | - |

#### Response

```json
[
  {
    "id": "1706000000000-abc123",
    "timestamp": 1706000000000,
    "ip": "192.168.1.1",
    "method": "GET",
    "path": "/api/users",
    "status": 200,
    "duration": 15,
    "rateLimited": false
  },
  {
    "id": "1706000001000-def456",
    "timestamp": 1706000001000,
    "ip": "192.168.1.1",
    "method": "POST",
    "path": "/api/users",
    "status": 429,
    "duration": 2,
    "rateLimited": true
  }
]
```

**Status:** `200 OK`

**Fields:**
- `id`: Unique log entry identifier
- `timestamp`: Request timestamp in milliseconds
- `ip`: Client IP address
- `method`: HTTP method
- `path`: Request path
- `status`: HTTP status code
- `duration`: Request duration in milliseconds
- `rateLimited`: Whether request was rate limited

#### Examples

```bash
# Get last 100 logs
curl "http://localhost:8000/gateway/api/logs?limit=100"

# Get rate-limited requests only
curl "http://localhost:8000/gateway/api/logs?rateLimited=true"

# Get 4xx errors from specific IP
curl "http://localhost:8000/gateway/api/logs?ip=192.168.1.1&statusRange=4"

# Get 5xx server errors
curl "http://localhost:8000/gateway/api/logs?statusRange=5"
```

---

### DELETE /api/logs

Clear all request logs.

#### Request

```http
DELETE /gateway/api/logs
```

#### Response

```json
{
  "cleared": true
}
```

**Status:** `200 OK`

#### Example

```bash
curl -X DELETE http://localhost:8000/gateway/api/logs
```

---

### GET /api/logs/stats

Get request log statistics.

#### Request

```http
GET /gateway/api/logs/stats
```

#### Response

```json
{
  "total": 1543,
  "rateLimited": 42,
  "byStatus": {
    "200": 1401,
    "404": 58,
    "429": 42,
    "500": 42
  },
  "avgDuration": 23.5
}
```

**Status:** `200 OK`

**Fields:**
- `total`: Total number of logged requests
- `rateLimited`: Number of rate-limited requests
- `byStatus`: Request count grouped by status code
- `avgDuration`: Average request duration in milliseconds

#### Example

```bash
curl http://localhost:8000/gateway/api/logs/stats
```

---

### GET /api/rate-limit/metrics

Get aggregated rate limit metrics.

#### Request

```http
GET /gateway/api/rate-limit/metrics
```

#### Response

```json
{
  "totalRequests": 1543,
  "blockedRequests": 42,
  "allowedRequests": 1501,
  "activeBuckets": 12,
  "config": {
    "capacity": 100,
    "windowSeconds": 60
  }
}
```

**Status:** `200 OK`

**Error Response (Rate Limiting Disabled):**

```json
{
  "error": "Rate limiting not enabled"
}
```

**Status:** `400 Bad Request`

**Fields:**
- `totalRequests`: Total number of requests processed
- `blockedRequests`: Number of requests blocked by rate limiter
- `allowedRequests`: Number of requests allowed
- `activeBuckets`: Number of unique keys being tracked
- `config`: Rate limiter configuration
  - `capacity`: Maximum tokens per bucket
  - `windowSeconds`: Time window in seconds

#### Example

```bash
curl http://localhost:8000/gateway/api/rate-limit/metrics
```

---

### GET /api/rate-limit/buckets

Get active rate limit buckets with their current state.

#### Request

```http
GET /gateway/api/rate-limit/buckets?limit=100
```

**Query Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `limit` | `number` | Maximum number of buckets to return | `100` |

#### Response

```json
[
  {
    "key": "192.168.1.1",
    "tokens": 87,
    "retryAfter": 0,
    "lastActivity": 1706000000000
  },
  {
    "key": "192.168.1.2",
    "tokens": 0,
    "retryAfter": 5,
    "lastActivity": 1706000001000
  }
]
```

**Status:** `200 OK`

**Error Response (Rate Limiting Disabled):**

```json
{
  "error": "Rate limiting not enabled"
}
```

**Status:** `400 Bad Request`

**Fields:**
- `key`: Bucket key (IP address, user ID, etc.)
- `tokens`: Current available tokens
- `retryAfter`: Seconds until next token (0 if tokens available)
- `lastActivity`: Last request timestamp in milliseconds

#### Example

```bash
# Get all active buckets
curl http://localhost:8000/gateway/api/rate-limit/buckets

# Get first 10 buckets
curl "http://localhost:8000/gateway/api/rate-limit/buckets?limit=10"
```

---

### DELETE /api/rate-limit/buckets/:key

Clear a specific rate limit bucket, resetting its token count.

#### Request

```http
DELETE /gateway/api/rate-limit/buckets/192.168.1.1
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `key` | `string` | Bucket key to clear (URL-encoded) |

#### Response

```json
{
  "deleted": true,
  "key": "192.168.1.1"
}
```

**Status:** `200 OK`

**Error Response (Rate Limiting Disabled):**

```json
{
  "error": "Rate limiting not enabled"
}
```

**Status:** `400 Bad Request`

**Fields:**
- `deleted`: Whether bucket was deleted
- `key`: The cleared bucket key

#### Examples

```bash
# Clear bucket for specific IP
curl -X DELETE http://localhost:8000/gateway/api/rate-limit/buckets/192.168.1.1

# Clear bucket with URL-encoded key
curl -X DELETE "http://localhost:8000/gateway/api/rate-limit/buckets/user%3A123"
```

---

### POST /api/rate-limit/clear

Clear all rate limit buckets, resetting all token counts.

#### Request

```http
POST /gateway/api/rate-limit/clear
```

#### Response

```json
{
  "cleared": 42
}
```

**Status:** `200 OK`

**Error Response (Rate Limiting Disabled):**

```json
{
  "error": "Rate limiting not enabled"
}
```

**Status:** `400 Bad Request`

**Fields:**
- `cleared`: Number of buckets cleared

#### Example

```bash
curl -X POST http://localhost:8000/gateway/api/rate-limit/clear
```

---

### GET /api/metrics/history

Get historical metrics snapshots from KeyVal persistence.

Snapshots are collected every second and stored for up to 1 hour (3600 entries).

#### Request

```http
GET /gateway/api/metrics/history?limit=60
```

**Query Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `limit` | `number` | Maximum number of snapshots to return | `60` |

#### Response

```json
[
  {
    "timestamp": 1706000000000,
    "totalRequests": 1500,
    "blockedRequests": 40,
    "allowedRequests": 1460,
    "activeBuckets": 12
  },
  {
    "timestamp": 1706000001000,
    "totalRequests": 1543,
    "blockedRequests": 42,
    "allowedRequests": 1501,
    "activeBuckets": 12
  }
]
```

**Status:** `200 OK`

**Fields:**
- `timestamp`: Snapshot timestamp in milliseconds
- `totalRequests`: Total requests at this point
- `blockedRequests`: Blocked requests count
- `allowedRequests`: Allowed requests count
- `activeBuckets`: Number of active buckets

#### Examples

```bash
# Get last 60 seconds (default)
curl http://localhost:8000/gateway/api/metrics/history

# Get last 5 minutes
curl "http://localhost:8000/gateway/api/metrics/history?limit=300"

# Get full hour
curl "http://localhost:8000/gateway/api/metrics/history?limit=3600"
```

---

### DELETE /api/metrics/history

Clear all stored metrics history from KeyVal.

#### Request

```http
DELETE /gateway/api/metrics/history
```

#### Response

```json
{
  "cleared": true
}
```

**Status:** `200 OK`

#### Example

```bash
curl -X DELETE http://localhost:8000/gateway/api/metrics/history
```

---

### GET /api/shell/excludes

Get all shell excludes (basenames that bypass the app shell).

Returns combined list from environment variables and KeyVal persistence.

#### Request

```http
GET /gateway/api/shell/excludes
```

#### Response

```json
[
  {
    "basename": "cpanel",
    "source": "env"
  },
  {
    "basename": "admin",
    "source": "env"
  },
  {
    "basename": "legacy",
    "source": "keyval",
    "addedAt": 1706000000000
  }
]
```

**Status:** `200 OK`

**Error Response (Shell Not Configured):**

```json
{
  "error": "Shell not configured"
}
```

**Status:** `400 Bad Request`

**Fields:**
- `basename`: The excluded basename
- `source`: Source of the exclude
  - `env`: From `GATEWAY_SHELL_EXCLUDES` environment variable
  - `keyval`: Added dynamically via API
- `addedAt`: Timestamp when added (only for `keyval` entries)

#### Example

```bash
curl http://localhost:8000/gateway/api/shell/excludes
```

---

### POST /api/shell/excludes

Add a new shell exclude (basename that bypasses the app shell).

Excludes added via API are stored in KeyVal and persist across restarts.

#### Request

```http
POST /gateway/api/shell/excludes
Content-Type: application/json

{
  "basename": "legacy"
}
```

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `basename` | `string` | Yes | Basename to exclude (alphanumeric, hyphen, underscore only) |

#### Response

```json
{
  "added": true,
  "basename": "legacy",
  "source": "keyval"
}
```

**Status:** `200 OK`

**Error Responses:**

**Shell Not Configured:**
```json
{
  "error": "Shell not configured"
}
```
**Status:** `400 Bad Request`

**Missing basename:**
```json
{
  "error": "basename is required"
}
```
**Status:** `400 Bad Request`

**Invalid format:**
```json
{
  "error": "Invalid basename format"
}
```
**Status:** `400 Bad Request`

**Already excluded via environment:**
```json
{
  "error": "Already excluded via environment"
}
```
**Status:** `400 Bad Request`

#### Examples

```bash
# Add new exclude
curl -X POST http://localhost:8000/gateway/api/shell/excludes \
  -H "Content-Type: application/json" \
  -d '{"basename": "legacy"}'

# Add with hyphen
curl -X POST http://localhost:8000/gateway/api/shell/excludes \
  -H "Content-Type: application/json" \
  -d '{"basename": "old-app"}'
```

---

### DELETE /api/shell/excludes/:basename

Remove a shell exclude that was added via API.

Cannot remove excludes from environment variables.

#### Request

```http
DELETE /gateway/api/shell/excludes/legacy
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `basename` | `string` | Basename to remove |

#### Response

```json
{
  "removed": true,
  "basename": "legacy"
}
```

**Status:** `200 OK`

**Error Responses:**

**Shell Not Configured:**
```json
{
  "error": "Shell not configured"
}
```
**Status:** `400 Bad Request`

**Cannot remove environment-based exclude:**
```json
{
  "error": "Cannot remove environment-based exclude"
}
```
**Status:** `400 Bad Request`

#### Examples

```bash
# Remove exclude
curl -X DELETE http://localhost:8000/gateway/api/shell/excludes/legacy

# Remove with encoded characters
curl -X DELETE "http://localhost:8000/gateway/api/shell/excludes/old-app"
```

---

### POST /api/cache/invalidate

Invalidate response cache entries.

> **Note:** Cache is currently disabled. This endpoint returns an error.

#### Request

```http
POST /gateway/api/cache/invalidate
Content-Type: application/json

{
  "key": "GET:/api/users",
  "pattern": "^/api/.*"
}
```

**Body Parameters:**

| Field | Type | Description |
|-------|------|-------------|
| `key` | `string` | Exact key to invalidate |
| `pattern` | `string` | Regex pattern to invalidate multiple entries |

**Rules:**
- Provide `key` OR `pattern`, not both
- If none provided, invalidates all

#### Response (Error - Cache Disabled)

```json
{
  "error": "Cache not enabled"
}
```

**Status:** `400 Bad Request`

#### Response (When Cache Enabled)

**Invalidate specific key:**
```json
{
  "invalidated": 1
}
```

**Invalidate by pattern:**
```json
{
  "invalidated": 42
}
```

**Invalidate all:**
```json
{
  "invalidated": "all"
}
```

**Status:** `200 OK`

#### Examples

```bash
# Invalidate specific key
curl -X POST http://localhost:8000/gateway/api/cache/invalidate \
  -H "Content-Type: application/json" \
  -d '{"key": "GET:/api/users"}'

# Invalidate by pattern
curl -X POST http://localhost:8000/gateway/api/cache/invalidate \
  -H "Content-Type: application/json" \
  -d '{"pattern": "^/api/users/.*"}'

# Invalidate all
curl -X POST http://localhost:8000/gateway/api/cache/invalidate \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## Rate Limiting Headers

When rate limiting is active, the gateway adds informational headers to all responses:

### Success Response

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
```

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Total bucket capacity |
| `X-RateLimit-Remaining` | Remaining tokens |

### Rate Limited Response

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 5
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1706000000000

{
  "error": "Too Many Requests"
}
```

| Header | Description |
|--------|-------------|
| `Retry-After` | Seconds until next token |
| `X-RateLimit-Limit` | Total bucket capacity |
| `X-RateLimit-Remaining` | Always `0` on 429 |
| `X-RateLimit-Reset` | Reset timestamp (ms) |

---

## CORS Headers

### Preflight Request

```http
OPTIONS /gateway/api/stats
Origin: https://app.example.com
Access-Control-Request-Method: GET
Access-Control-Request-Headers: Content-Type
```

### Preflight Response

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, POST, PUT, DELETE
Access-Control-Allow-Headers: Content-Type
Access-Control-Max-Age: 86400
Access-Control-Allow-Credentials: true
```

### Actual Response

```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Access-Control-Expose-Headers: X-Request-Id, X-RateLimit-Remaining
```

---

## Errors

### Error Response Format

```json
{
  "error": "Error message"
}
```

### Common Errors

#### 400 Bad Request

```json
{
  "error": "Cache not enabled"
}
```

Cause: Attempted to use a disabled feature.

#### 429 Too Many Requests

```json
{
  "error": "Too Many Requests"
}
```

Cause: Rate limit exceeded.

Additional headers:
- `Retry-After`: Seconds until you can retry
- `X-RateLimit-Reset`: Reset timestamp

#### 500 Internal Server Error

```json
{
  "error": "Internal server error"
}
```

Cause: Unexpected server error.

---

## TypeScript Types

### GatewayConfig

```typescript
interface GatewayConfig {
  shellDir?: string;
  shellExcludes?: string;
  rateLimit?: RateLimitConfig;
  cors?: CorsConfig;
  cache?: CacheConfig;
}
```

### RateLimitConfig

```typescript
interface RateLimitConfig {
  requests?: number;
  window?: string;
  keyBy?: "ip" | "user" | ((req: Request) => string);
  excludePaths?: string[];
}
```

### CorsConfig

```typescript
interface CorsConfig {
  origin?: string | string[];
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
  preflight?: boolean;
}
```

### CacheConfig

```typescript
interface CacheConfig {
  ttl?: number;
  methods?: string[];
  maxEntries?: number;
  excludePaths?: string[];
}
```

### RequestLogEntry

```typescript
interface RequestLogEntry {
  id: string;
  timestamp: number;
  ip: string;
  method: string;
  path: string;
  status: number;
  duration: number;
  rateLimited: boolean;
}
```

### RateLimitMetrics

```typescript
interface RateLimitMetrics {
  totalRequests: number;
  blockedRequests: number;
  allowedRequests: number;
  activeBuckets: number;
  config: {
    capacity: number;
    windowSeconds: number;
  };
}
```

### BucketInfo

```typescript
interface BucketInfo {
  key: string;
  tokens: number;
  retryAfter: number;
  lastActivity: number;
}
```

### MetricsSnapshot

```typescript
interface MetricsSnapshot {
  timestamp: number;
  totalRequests: number;
  blockedRequests: number;
  allowedRequests: number;
  activeBuckets: number;
}
```

### ShellExcludeEntry

```typescript
interface ShellExcludeEntry {
  basename: string;
  source: "env" | "keyval";
  addedAt?: number;
}
```

---

## Client SDK Example

### JavaScript/TypeScript

```typescript
class GatewayClient {
  constructor(private baseUrl: string) {}

  async getStats() {
    const res = await fetch(`${this.baseUrl}/gateway/api/stats`);
    return res.json();
  }

  async getConfig() {
    const res = await fetch(`${this.baseUrl}/gateway/api/config`);
    return res.json();
  }

  async getLogs(options: {
    limit?: number;
    ip?: string;
    rateLimited?: boolean;
    statusRange?: number;
  } = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", String(options.limit));
    if (options.ip) params.set("ip", options.ip);
    if (options.rateLimited) params.set("rateLimited", "true");
    if (options.statusRange) params.set("statusRange", String(options.statusRange));

    const res = await fetch(`${this.baseUrl}/gateway/api/logs?${params}`);
    return res.json();
  }

  async clearLogs() {
    const res = await fetch(`${this.baseUrl}/gateway/api/logs`, {
      method: "DELETE",
    });
    return res.json();
  }

  async getLogStats() {
    const res = await fetch(`${this.baseUrl}/gateway/api/logs/stats`);
    return res.json();
  }

  async getRateLimitMetrics() {
    const res = await fetch(`${this.baseUrl}/gateway/api/rate-limit/metrics`);
    return res.json();
  }

  async getRateLimitBuckets(limit = 100) {
    const res = await fetch(
      `${this.baseUrl}/gateway/api/rate-limit/buckets?limit=${limit}`
    );
    return res.json();
  }

  async clearRateLimitBucket(key: string) {
    const encodedKey = encodeURIComponent(key);
    const res = await fetch(
      `${this.baseUrl}/gateway/api/rate-limit/buckets/${encodedKey}`,
      { method: "DELETE" }
    );
    return res.json();
  }

  async clearAllRateLimitBuckets() {
    const res = await fetch(`${this.baseUrl}/gateway/api/rate-limit/clear`, {
      method: "POST",
    });
    return res.json();
  }

  async getMetricsHistory(limit = 60) {
    const res = await fetch(
      `${this.baseUrl}/gateway/api/metrics/history?limit=${limit}`
    );
    return res.json();
  }

  async clearMetricsHistory() {
    const res = await fetch(`${this.baseUrl}/gateway/api/metrics/history`, {
      method: "DELETE",
    });
    return res.json();
  }

  async getShellExcludes() {
    const res = await fetch(`${this.baseUrl}/gateway/api/shell/excludes`);
    return res.json();
  }

  async addShellExclude(basename: string) {
    const res = await fetch(`${this.baseUrl}/gateway/api/shell/excludes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ basename }),
    });
    return res.json();
  }

  async removeShellExclude(basename: string) {
    const res = await fetch(
      `${this.baseUrl}/gateway/api/shell/excludes/${basename}`,
      { method: "DELETE" }
    );
    return res.json();
  }

  async invalidateCache(options: { key?: string; pattern?: string }) {
    const res = await fetch(`${this.baseUrl}/gateway/api/cache/invalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });
    return res.json();
  }

  connectSSE(callback: (data: any) => void): EventSource {
    const eventSource = new EventSource(`${this.baseUrl}/gateway/api/sse`);
    eventSource.onmessage = (event) => {
      callback(JSON.parse(event.data));
    };
    return eventSource;
  }
}

// Usage
const client = new GatewayClient("http://localhost:8000");

// Get statistics
const stats = await client.getStats();
console.log(stats.rateLimit.enabled);

// Get logs with filters
const logs = await client.getLogs({ rateLimited: true, limit: 100 });
console.log(`Found ${logs.length} rate-limited requests`);

// Get rate limit metrics
const metrics = await client.getRateLimitMetrics();
console.log(`Blocked: ${metrics.blockedRequests}/${metrics.totalRequests}`);

// Get active buckets
const buckets = await client.getRateLimitBuckets();
console.log(`Active buckets: ${buckets.length}`);

// Clear specific bucket
await client.clearRateLimitBucket("192.168.1.1");

// Get metrics history
const history = await client.getMetricsHistory(300); // Last 5 minutes
console.log(`History snapshots: ${history.length}`);

// Manage shell excludes
const excludes = await client.getShellExcludes();
await client.addShellExclude("legacy");
await client.removeShellExclude("legacy");

// Connect to SSE for real-time updates
const eventSource = client.connectSSE((data) => {
  console.log("Real-time update:", data);
  console.log("Active buckets:", data.rateLimit?.metrics.activeBuckets);
  console.log("Recent logs:", data.recentLogs.length);
});

// Cleanup when done
eventSource.close();
```

---

## Rate Limit Example

```typescript
// Make requests until hitting the limit
async function testRateLimit() {
  const responses = [];

  for (let i = 0; i < 105; i++) {
    const res = await fetch("http://localhost:8000/api/health");
    responses.push({
      status: res.status,
      remaining: res.headers.get("X-RateLimit-Remaining"),
      limit: res.headers.get("X-RateLimit-Limit"),
    });
  }

  // Last 5 requests should be 429
  console.log(responses.slice(-5));
  // [
  //   { status: 429, remaining: "0", limit: "100" },
  //   { status: 429, remaining: "0", limit: "100" },
  //   ...
  // ]
}
```

---

## Next Steps

- [Configuration](guides/configuration.md) - Configuration reference
- [Rate Limiting](concepts/rate-limiting.md) - Rate limiting concepts
- [CORS](concepts/cors.md) - CORS concepts
