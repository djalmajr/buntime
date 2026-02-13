# API Reference

Complete reference for the plugin-metrics API.

## Base URL

All routes are served under the plugin base path:

```
/metrics/api/metrics/*
```

## Authentication

Metrics API routes are accessible without additional authentication by default, but can be protected via the authn plugin (if enabled).

## Endpoints

### GET /api/metrics/

Returns current pool metrics as JSON. Lightweight endpoint for programmatic consumption and health checks.

#### Request

```http
GET /metrics/api/metrics/
```

#### Response

```json
{
  "pool": {
    "size": 500,
    "active": 12,
    "idle": 3,
    "creating": 0,
    "total": 15,
    "utilization": 0.03
  },
  "uptime": 86400,
  "timestamp": "2024-01-23T10:30:00.000Z"
}
```

**Status:** `200 OK`

**Fields:**
- `pool`: Worker pool metrics
  - `size`: Maximum configured pool size
  - `active`: Workers currently handling requests
  - `idle`: Workers alive but not handling requests
  - `creating`: Workers being spawned
  - `total`: Total workers (`active + idle + creating`)
  - `utilization`: Ratio of active workers to pool size (`active / size`)
- `uptime`: Server uptime in seconds
- `timestamp`: ISO 8601 timestamp of the snapshot

#### Examples

```bash
curl http://localhost:8000/metrics/api/metrics/
```

```typescript
const res = await fetch("/metrics/api/metrics/");
const data = await res.json();

console.log(`Pool utilization: ${(data.pool.utilization * 100).toFixed(1)}%`);
console.log(`Workers: ${data.pool.active} active, ${data.pool.idle} idle`);
```

---

### GET /api/metrics/prometheus

Returns metrics in Prometheus text exposition format. Compatible with Prometheus scraping.

#### Request

```http
GET /metrics/api/metrics/prometheus
Accept: text/plain
```

#### Response

```http
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8

# HELP buntime_pool_size Maximum pool size
# TYPE buntime_pool_size gauge
buntime_pool_size 500

# HELP buntime_pool_active Active workers
# TYPE buntime_pool_active gauge
buntime_pool_active 12

# HELP buntime_pool_idle Idle workers
# TYPE buntime_pool_idle gauge
buntime_pool_idle 3

# HELP buntime_pool_creating Workers being created
# TYPE buntime_pool_creating gauge
buntime_pool_creating 0

# HELP buntime_pool_total Total workers
# TYPE buntime_pool_total gauge
buntime_pool_total 15

# HELP buntime_pool_utilization Pool utilization ratio
# TYPE buntime_pool_utilization gauge
buntime_pool_utilization 0.03

# HELP buntime_uptime_seconds Server uptime in seconds
# TYPE buntime_uptime_seconds counter
buntime_uptime_seconds 86400
```

**Status:** `200 OK`

**Content-Type:** `text/plain; charset=utf-8`

**Exported Metrics:**

| Metric Name | Type | Description |
|-------------|------|-------------|
| `buntime_pool_size` | gauge | Maximum configured pool size |
| `buntime_pool_active` | gauge | Workers currently handling requests |
| `buntime_pool_idle` | gauge | Idle workers |
| `buntime_pool_creating` | gauge | Workers being spawned |
| `buntime_pool_total` | gauge | Total workers |
| `buntime_pool_utilization` | gauge | Utilization ratio (0.0 - 1.0) |
| `buntime_uptime_seconds` | counter | Server uptime in seconds |

#### Examples

```bash
# Scrape metrics
curl http://localhost:8000/metrics/api/metrics/prometheus

# Verify specific metric
curl -s http://localhost:8000/metrics/api/metrics/prometheus | grep buntime_pool_active
```

---

### GET /api/metrics/sse

Server-Sent Events endpoint for real-time metrics streaming. Pushes pool metrics at the configured interval (default: 1000ms).

#### Request

```http
GET /metrics/api/metrics/sse
Accept: text/event-stream
```

#### Response

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"pool":{"size":500,"active":12,"idle":3,"creating":0,"total":15,"utilization":0.03},"uptime":86400,"timestamp":"2024-01-23T10:30:00.000Z"}

data: {"pool":{"size":500,"active":14,"idle":1,"creating":0,"total":15,"utilization":0.028},"uptime":86401,"timestamp":"2024-01-23T10:30:01.000Z"}
```

**Status:** `200 OK`

**Event Data Fields:**
- Same structure as the JSON metrics endpoint (`GET /api/metrics/`)

#### Examples

```bash
# Stream metrics in terminal
curl -N http://localhost:8000/metrics/api/metrics/sse
```

```typescript
// JavaScript EventSource
const eventSource = new EventSource("/metrics/api/metrics/sse");

eventSource.onmessage = (event) => {
  const metrics = JSON.parse(event.data);
  console.log(`Pool utilization: ${(metrics.pool.utilization * 100).toFixed(1)}%`);
  console.log(`Active: ${metrics.pool.active}, Idle: ${metrics.pool.idle}`);
};

eventSource.onerror = (error) => {
  console.error("SSE connection error:", error);
  eventSource.close();
};
```

```typescript
// React hook example
function useMetricsStream() {
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    const source = new EventSource("/metrics/api/metrics/sse");
    source.onmessage = (e) => setMetrics(JSON.parse(e.data));
    return () => source.close();
  }, []);

  return metrics;
}
```

---

### GET /api/metrics/stats

Returns full statistics including pool-level metrics and individual worker details.

#### Request

```http
GET /metrics/api/metrics/stats
```

#### Response

```json
{
  "pool": {
    "size": 500,
    "active": 12,
    "idle": 3,
    "creating": 0,
    "total": 15,
    "utilization": 0.03
  },
  "workers": [
    {
      "id": "worker-abc-123",
      "app": "my-app@latest",
      "state": "active",
      "requests": 1542,
      "uptime": 3600,
      "memory": {
        "rss": 52428800,
        "heapUsed": 31457280
      }
    },
    {
      "id": "worker-def-456",
      "app": "my-app@latest",
      "state": "idle",
      "requests": 890,
      "uptime": 3500,
      "memory": {
        "rss": 48234496,
        "heapUsed": 28311552
      }
    },
    {
      "id": "worker-ghi-789",
      "app": "admin-panel",
      "state": "creating",
      "requests": 0,
      "uptime": 2,
      "memory": {
        "rss": 0,
        "heapUsed": 0
      }
    }
  ]
}
```

**Status:** `200 OK`

**Fields:**
- `pool`: Aggregate pool metrics (same as `GET /api/metrics/`)
- `workers`: Array of individual worker details
  - `id`: Unique worker identifier
  - `app`: Application name and version
  - `state`: Worker state (`creating`, `ready`, `active`, `idle`, `terminated`)
  - `requests`: Total requests handled by this worker
  - `uptime`: Time since worker creation (seconds)
  - `memory`: Memory usage
    - `rss`: Resident Set Size in bytes
    - `heapUsed`: V8 heap used in bytes

**Worker States:**

| State | Description |
|-------|-------------|
| `creating` | Worker is being spawned, not yet ready |
| `ready` | Worker is initialized and ready for requests |
| `active` | Worker is currently handling a request |
| `idle` | Worker is alive but not handling any requests |
| `terminated` | Worker has been shut down |

#### Examples

```bash
# Get full stats
curl http://localhost:8000/metrics/api/metrics/stats
```

```typescript
const res = await fetch("/metrics/api/metrics/stats");
const { pool, workers } = await res.json();

// Pool overview
console.log(`Pool: ${pool.active}/${pool.total} active (${pool.size} max)`);

// Per-worker breakdown
workers.forEach((w) => {
  const memMB = (w.memory.rss / 1024 / 1024).toFixed(1);
  console.log(`  ${w.id} [${w.app}] ${w.state} - ${w.requests} reqs, ${memMB}MB`);
});

// Find workers with high memory usage
const highMem = workers.filter((w) => w.memory.rss > 100 * 1024 * 1024);
if (highMem.length > 0) {
  console.warn(`${highMem.length} workers using >100MB RSS`);
}
```

---

## TypeScript Types

```typescript
interface PoolMetrics {
  size: number;
  active: number;
  idle: number;
  creating: number;
  total: number;
  utilization: number;
}

interface WorkerMetrics {
  id: string;
  app: string;
  state: "creating" | "ready" | "active" | "idle" | "terminated";
  requests: number;
  uptime: number;
  memory: {
    rss: number;
    heapUsed: number;
  };
}

interface MetricsResponse {
  pool: PoolMetrics;
  uptime: number;
  timestamp: string;
}

interface StatsResponse {
  pool: PoolMetrics;
  workers: WorkerMetrics[];
}
```

---

## Client SDK Example

```typescript
class MetricsClient {
  constructor(private baseUrl: string) {}

  async getMetrics(): Promise<MetricsResponse> {
    const res = await fetch(`${this.baseUrl}/metrics/api/metrics/`);
    return res.json();
  }

  async getPrometheus(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/metrics/api/metrics/prometheus`);
    return res.text();
  }

  async getStats(): Promise<StatsResponse> {
    const res = await fetch(`${this.baseUrl}/metrics/api/metrics/stats`);
    return res.json();
  }

  connectSSE(callback: (data: MetricsResponse) => void): EventSource {
    const source = new EventSource(`${this.baseUrl}/metrics/api/metrics/sse`);
    source.onmessage = (e) => callback(JSON.parse(e.data));
    return source;
  }
}

// Usage
const client = new MetricsClient("http://localhost:8000");

// Quick health check
const { pool } = await client.getMetrics();
console.log(`Utilization: ${(pool.utilization * 100).toFixed(1)}%`);

// Detailed worker info
const { workers } = await client.getStats();
console.log(`Total workers: ${workers.length}`);

// Stream real-time metrics
const sse = client.connectSSE((data) => {
  console.log(`Active: ${data.pool.active}/${data.pool.total}`);
});

// Cleanup
sse.close();
```

---

## Next Steps

- [Overview](concepts/overview.md) - Architecture and pool/worker metrics concepts
- [Configuration](guides/configuration.md) - Prometheus and SSE settings
- [Prometheus Guide](guides/prometheus.md) - Scraping and Grafana integration
