# @buntime/metrics

Pool metrics extension for Buntime server.

## Features

- JSON metrics endpoint
- Prometheus format support
- Server-Sent Events (SSE) streaming
- Full pool + workers stats

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /_/metrics/` | JSON metrics |
| `GET /_/metrics/prometheus` | Prometheus format |
| `GET /_/metrics/sse` | SSE stream (real-time) |
| `GET /_/metrics/stats` | Full stats (pool + workers) |

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `prometheus` | `boolean` | `true` | Enable Prometheus endpoint |
| `sseInterval` | `number` | `1000` | SSE update interval (ms) |

## Usage

```typescript
// buntime.config.ts
export default {
  plugins: [
    ["@buntime/metrics", {
      sseInterval: 2000,
    }],
  ],
}
```

## Priority

**0** - Runs first, collects request metrics.
