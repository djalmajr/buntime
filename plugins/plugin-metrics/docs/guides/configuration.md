# Configuration

Complete reference for all plugin-metrics configuration options.

## Configuration Method

### manifest.yaml

Static plugin configuration:

```yaml
# plugins/plugin-metrics/manifest.yaml
name: "@buntime/plugin-metrics"
base: "/metrics"
enabled: false
injectBase: true

entrypoint: dist/client/index.html
pluginEntry: dist/plugin.js

menus:
  - icon: lucide:activity
    path: /metrics
    title: Metrics
    items:
      - icon: lucide:layout-dashboard
        path: /metrics
        title: Overview
      - icon: lucide:cpu
        path: /metrics/workers
        title: Workers

prometheus: true
sseInterval: 1000
```

## Configuration Options

### prometheus

Enables the Prometheus text exposition format endpoint at `/api/metrics/prometheus`.

- **Type:** `boolean`
- **Default:** `true`

**Example:**
```yaml
prometheus: true
```

**When enabled:**
- `GET /api/metrics/prometheus` returns metrics in Prometheus text format
- Metrics include `# HELP` and `# TYPE` annotations
- Compatible with Prometheus scraping

**When disabled:**
- `GET /api/metrics/prometheus` returns `404 Not Found`
- JSON and SSE endpoints remain available

**Usage scenarios:**

| Scenario | Setting | Reason |
|----------|---------|--------|
| Production with Prometheus | `true` | Enable scraping |
| Development without monitoring | `false` | Reduce unnecessary endpoints |
| JSON-only consumption | `false` | Only need JSON/SSE formats |

---

### sseInterval

Interval in milliseconds between SSE event pushes. Controls how frequently connected clients receive metric updates.

- **Type:** `number`
- **Default:** `1000`
- **Unit:** milliseconds

**Example:**
```yaml
sseInterval: 2000
```

**Trade-offs:**

| sseInterval | Update Rate | CPU/Network | Use Case |
|------------|-------------|-------------|----------|
| `250` | 4 per second | Higher | Real-time monitoring dashboards |
| `500` | 2 per second | Moderate | Active debugging, load testing |
| `1000` | 1 per second | Low (default) | General monitoring |
| `5000` | Every 5 seconds | Minimal | Background monitoring |
| `10000` | Every 10 seconds | Very low | Infrequent health checks |

> Lower intervals provide more granular metrics but increase CPU and network usage, especially with multiple connected SSE clients.

---

## Complete Examples

### Local Development

Standard setup for development:

```yaml
name: "@buntime/plugin-metrics"
base: "/metrics"
enabled: true

prometheus: false
sseInterval: 500
```

### Production with Prometheus

Full monitoring stack integration:

```yaml
name: "@buntime/plugin-metrics"
base: "/metrics"
enabled: true

prometheus: true
sseInterval: 1000
```

Pair with Prometheus scrape config:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: buntime
    metrics_path: /metrics/api/metrics/prometheus
    scrape_interval: 15s
    static_configs:
      - targets: ['buntime:8000']
```

### Production without Prometheus

JSON-only metrics with infrequent updates:

```yaml
name: "@buntime/plugin-metrics"
base: "/metrics"
enabled: true

prometheus: false
sseInterval: 5000
```

### Disabled (Default)

The plugin is disabled by default:

```yaml
name: "@buntime/plugin-metrics"
enabled: false
```

## Validation

### Verify Metrics Endpoint

```bash
# JSON metrics
curl http://localhost:8000/metrics/api/metrics/

# Expected response
# {"pool":{"size":500,"active":0,"idle":0,"creating":0,"total":0,"utilization":0},"uptime":...}
```

### Verify Prometheus Endpoint

```bash
# Prometheus text format
curl http://localhost:8000/metrics/api/metrics/prometheus

# Expected response
# # HELP buntime_pool_size Maximum pool size
# # TYPE buntime_pool_size gauge
# buntime_pool_size 500
# ...
```

### Verify SSE Interval

```bash
# Observe SSE event timing
curl -N http://localhost:8000/metrics/api/metrics/sse 2>&1 | while read line; do
  echo "$(date +%H:%M:%S.%N) $line"
done
```

Events should arrive at the configured interval.

### Verify Full Stats

```bash
# Full stats with worker details
curl http://localhost:8000/metrics/api/metrics/stats | jq .

# Check worker count
curl -s http://localhost:8000/metrics/api/metrics/stats | jq '.workers | length'
```

## Monitoring Best Practices

### Scrape Interval

Match the Prometheus scrape interval to the expected metric change rate:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: buntime
    scrape_interval: 15s  # Default Prometheus interval
    metrics_path: /metrics/api/metrics/prometheus
```

For high-traffic environments, consider a shorter interval:

```yaml
scrape_interval: 5s  # More granular data, more storage
```

### Alerting

Use Prometheus alerting rules based on pool metrics:

```yaml
# alerts.yml
groups:
  - name: buntime
    rules:
      - alert: HighPoolUtilization
        expr: buntime_pool_utilization > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Buntime pool utilization above 80%"

      - alert: PoolExhausted
        expr: buntime_pool_active == buntime_pool_size
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Buntime worker pool is exhausted"
```

## Next Steps

- [API Reference](../api-reference.md) - Complete endpoint documentation
- [Overview](../concepts/overview.md) - Architecture and metrics concepts
- [Prometheus Guide](prometheus.md) - Scraping and Grafana integration
