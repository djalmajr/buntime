# API Reference

Complete reference for the plugin-logs API.

## Base URL

All routes are served under the plugin base path:

```
/logs/api/*
```

## Authentication

Log API routes are accessible without additional authentication by default, but can be protected via the authn plugin (if enabled).

## Endpoints

### GET /api/

Returns log entries with optional filtering, plus statistics.

#### Request

```http
GET /logs/api/?level=error&search=timeout&limit=50
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `level` | `string` | - | Filter by log level (`debug`, `info`, `warn`, `error`) |
| `search` | `string` | - | Search text within log messages |
| `limit` | `number` | `100` | Maximum entries to return |

#### Response

```json
{
  "logs": [
    {
      "timestamp": "2024-01-23T10:30:00.000Z",
      "level": "error",
      "message": "Connection timeout after 5000ms",
      "source": "proxy",
      "meta": { "target": "https://api.example.com", "duration": 5000 }
    },
    {
      "timestamp": "2024-01-23T10:29:55.000Z",
      "level": "error",
      "message": "Database connection timeout",
      "source": "database",
      "meta": { "host": "db.internal", "port": 5432 }
    }
  ],
  "stats": {
    "total": 1543,
    "debug": 200,
    "info": 1100,
    "warn": 193,
    "error": 50
  }
}
```

**Status:** `200 OK`

**Fields:**
- `logs`: Array of log entries matching filters
  - `timestamp`: ISO 8601 timestamp
  - `level`: Log level (`debug`, `info`, `warn`, `error`)
  - `message`: Log message text
  - `source`: Origin plugin or component (optional)
  - `meta`: Arbitrary metadata object (optional)
- `stats`: Aggregate statistics across all logs (unfiltered)
  - `total`: Total log entries in the ring buffer
  - `debug`: Count of debug-level entries
  - `info`: Count of info-level entries
  - `warn`: Count of warn-level entries
  - `error`: Count of error-level entries

#### Examples

```bash
# Get all logs (default limit: 100)
curl http://localhost:8000/logs/api/

# Get only error-level logs
curl "http://localhost:8000/logs/api/?level=error"

# Search for "timeout" in messages
curl "http://localhost:8000/logs/api/?search=timeout"

# Combine filters with custom limit
curl "http://localhost:8000/logs/api/?level=warn&search=deprecated&limit=20"
```

```typescript
// TypeScript fetch
const res = await fetch("/logs/api/?level=error&limit=50");
const { logs, stats } = await res.json();

console.log(`${stats.error} errors out of ${stats.total} total logs`);
logs.forEach((entry) => {
  console.log(`[${entry.timestamp}] ${entry.source}: ${entry.message}`);
});
```

---

### GET /api/stats

Returns statistics only, without log entries. Lightweight endpoint for dashboards and health checks.

#### Request

```http
GET /logs/api/stats
```

#### Response

```json
{
  "total": 1543,
  "debug": 200,
  "info": 1100,
  "warn": 193,
  "error": 50
}
```

**Status:** `200 OK`

**Fields:**
- `total`: Total log entries currently in the ring buffer
- `debug`: Count of debug-level entries
- `info`: Count of info-level entries
- `warn`: Count of warn-level entries
- `error`: Count of error-level entries

#### Examples

```bash
curl http://localhost:8000/logs/api/stats
```

```typescript
const res = await fetch("/logs/api/stats");
const stats = await res.json();
console.log(`Error rate: ${((stats.error / stats.total) * 100).toFixed(1)}%`);
```

---

### GET /api/sse

Server-Sent Events endpoint for real-time log streaming. Pushes the full log + stats payload at a configurable interval (default: 1000ms).

#### Request

```http
GET /logs/api/sse
Accept: text/event-stream
```

#### Response

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"logs":[{"timestamp":"2024-01-23T10:30:00.000Z","level":"info","message":"Request processed","meta":{"duration":42}}],"stats":{"total":150,"debug":50,"info":80,"warn":15,"error":5}}

data: {"logs":[{"timestamp":"2024-01-23T10:30:01.000Z","level":"warn","message":"Slow query detected","source":"database","meta":{"duration":2300}}],"stats":{"total":151,"debug":50,"info":80,"warn":16,"error":5}}
```

**Status:** `200 OK`

**Event Data Fields:**
- `logs`: Array of all current log entries
- `stats`: Current statistics object

#### Examples

```bash
# Stream logs in terminal
curl -N http://localhost:8000/logs/api/sse
```

```typescript
// JavaScript EventSource
const eventSource = new EventSource("/logs/api/sse");

eventSource.onmessage = (event) => {
  const { logs, stats } = JSON.parse(event.data);
  console.log(`Total: ${stats.total}, Errors: ${stats.error}`);
  console.log(`Latest: ${logs[0]?.message}`);
};

eventSource.onerror = (error) => {
  console.error("SSE connection error:", error);
  eventSource.close();
};
```

```typescript
// React hook example
function useLogStream() {
  const [data, setData] = useState({ logs: [], stats: {} });

  useEffect(() => {
    const source = new EventSource("/logs/api/sse");
    source.onmessage = (e) => setData(JSON.parse(e.data));
    return () => source.close();
  }, []);

  return data;
}
```

---

### POST /api/clear

Clears all log entries from the ring buffer and resets statistics.

#### Request

```http
POST /logs/api/clear
```

#### Response

```json
{
  "cleared": true
}
```

**Status:** `200 OK`

**Fields:**
- `cleared`: Confirmation that logs were cleared

#### Example

```bash
curl -X POST http://localhost:8000/logs/api/clear
```

```typescript
await fetch("/logs/api/clear", { method: "POST" });
```

---

### POST /api/

Add a log entry programmatically via HTTP.

#### Request

```http
POST /logs/api/
Content-Type: application/json

{
  "level": "info",
  "message": "User logged in successfully",
  "source": "authn",
  "meta": { "userId": "user-123", "ip": "192.168.1.1" }
}
```

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `level` | `string` | Yes | Log level: `debug`, `info`, `warn`, `error` |
| `message` | `string` | Yes | Log message text |
| `source` | `string` | No | Origin identifier (plugin name, service, etc.) |
| `meta` | `object` | No | Arbitrary metadata key-value pairs |

#### Response

```json
{
  "added": true
}
```

**Status:** `200 OK`

**Fields:**
- `added`: Confirmation that the entry was added

#### Examples

```bash
# Add a simple log
curl -X POST http://localhost:8000/logs/api/ \
  -H "Content-Type: application/json" \
  -d '{"level": "info", "message": "Deployment complete"}'

# Add a log with source and metadata
curl -X POST http://localhost:8000/logs/api/ \
  -H "Content-Type: application/json" \
  -d '{
    "level": "error",
    "message": "Payment processing failed",
    "source": "billing",
    "meta": {
      "orderId": "ord-456",
      "errorCode": "CARD_DECLINED",
      "amount": 49.99
    }
  }'

# Add a debug log
curl -X POST http://localhost:8000/logs/api/ \
  -H "Content-Type: application/json" \
  -d '{
    "level": "debug",
    "message": "Cache miss for key users:list",
    "source": "cache",
    "meta": { "key": "users:list", "ttl": 300 }
  }'
```

```typescript
// TypeScript
await fetch("/logs/api/", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    level: "warn",
    message: "Deprecated API endpoint called",
    source: "gateway",
    meta: { path: "/api/v1/legacy", suggestion: "Use /api/v2/" },
  }),
});
```

---

## TypeScript Types

```typescript
type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  source?: string;
  meta?: Record<string, unknown>;
}

interface LogStats {
  total: number;
  debug: number;
  info: number;
  warn: number;
  error: number;
}

interface LogsResponse {
  logs: LogEntry[];
  stats: LogStats;
}
```

---

## Client SDK Example

```typescript
class LogsClient {
  constructor(private baseUrl: string) {}

  async getLogs(options: {
    level?: LogLevel;
    search?: string;
    limit?: number;
  } = {}) {
    const params = new URLSearchParams();
    if (options.level) params.set("level", options.level);
    if (options.search) params.set("search", options.search);
    if (options.limit) params.set("limit", String(options.limit));

    const res = await fetch(`${this.baseUrl}/logs/api/?${params}`);
    return res.json() as Promise<LogsResponse>;
  }

  async getStats() {
    const res = await fetch(`${this.baseUrl}/logs/api/stats`);
    return res.json() as Promise<LogStats>;
  }

  async addLog(entry: Omit<LogEntry, "timestamp">) {
    const res = await fetch(`${this.baseUrl}/logs/api/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    return res.json();
  }

  async clearLogs() {
    const res = await fetch(`${this.baseUrl}/logs/api/clear`, {
      method: "POST",
    });
    return res.json();
  }

  connectSSE(callback: (data: LogsResponse) => void): EventSource {
    const source = new EventSource(`${this.baseUrl}/logs/api/sse`);
    source.onmessage = (e) => callback(JSON.parse(e.data));
    return source;
  }
}

// Usage
const client = new LogsClient("http://localhost:8000");

// Get error logs
const { logs, stats } = await client.getLogs({ level: "error", limit: 50 });
console.log(`Found ${logs.length} errors out of ${stats.total} total`);

// Add a log entry
await client.addLog({
  level: "info",
  message: "Custom event occurred",
  source: "my-service",
});

// Stream real-time updates
const sse = client.connectSSE(({ logs, stats }) => {
  console.log(`Live: ${stats.total} entries, ${stats.error} errors`);
});

// Cleanup
sse.close();
```

---

## Next Steps

- [Overview](concepts/overview.md) - Ring buffer architecture and features
- [Configuration](guides/configuration.md) - Configuration options reference
