# Prometheus & Grafana Integration

Guide for scraping Buntime metrics with Prometheus and visualizing them in Grafana.

## Prerequisites

- Buntime running with `@buntime/plugin-metrics` enabled and `prometheus: true`
- Prometheus server (v2.x+)
- Grafana (v9.x+) for visualization (optional)

## Prometheus Setup

### 1. Verify Metrics Endpoint

Confirm the Prometheus endpoint is accessible:

```bash
curl http://buntime:8000/metrics/api/metrics/prometheus
```

Expected output:

```
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

### 2. Configure Prometheus Scraping

Add a scrape job to your `prometheus.yml`:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: buntime
    metrics_path: /metrics/api/metrics/prometheus
    scrape_interval: 15s
    scrape_timeout: 10s
    static_configs:
      - targets: ['buntime:8000']
        labels:
          environment: production
          service: buntime
```

### Multiple Buntime Instances

For multiple instances (e.g., Kubernetes pods):

```yaml
scrape_configs:
  - job_name: buntime
    metrics_path: /metrics/api/metrics/prometheus
    scrape_interval: 15s
    static_configs:
      - targets:
          - 'buntime-1:8000'
          - 'buntime-2:8000'
          - 'buntime-3:8000'
        labels:
          environment: production
```

### Kubernetes Service Discovery

For dynamic Kubernetes service discovery:

```yaml
scrape_configs:
  - job_name: buntime
    metrics_path: /metrics/api/metrics/prometheus
    scrape_interval: 15s
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_label_app]
        regex: buntime
        action: keep
      - source_labels: [__meta_kubernetes_pod_ip]
        target_label: __address__
        replacement: "$1:8000"
```

### 3. Verify Scraping

Check the Prometheus targets page (`http://prometheus:9090/targets`) to confirm Buntime is being scraped successfully.

Query a metric in the Prometheus expression browser:

```promql
buntime_pool_active
```

## Available Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `buntime_pool_size` | gauge | Maximum configured pool size |
| `buntime_pool_active` | gauge | Workers currently handling requests |
| `buntime_pool_idle` | gauge | Workers alive but not active |
| `buntime_pool_creating` | gauge | Workers being spawned |
| `buntime_pool_total` | gauge | Total workers |
| `buntime_pool_utilization` | gauge | Utilization ratio (0.0 - 1.0) |
| `buntime_uptime_seconds` | counter | Server uptime in seconds |

## PromQL Queries

### Pool Utilization

```promql
# Current pool utilization percentage
buntime_pool_utilization * 100

# 5-minute average utilization
avg_over_time(buntime_pool_utilization[5m]) * 100

# Utilization by instance
buntime_pool_utilization * 100
```

### Worker Counts

```promql
# Active workers over time
buntime_pool_active

# Idle workers over time
buntime_pool_idle

# Total workers over time
buntime_pool_total

# Workers being created (spike = scaling event)
buntime_pool_creating
```

### Capacity Planning

```promql
# Remaining capacity (slots available)
buntime_pool_size - buntime_pool_total

# Percentage of pool slots used
(buntime_pool_total / buntime_pool_size) * 100

# Rate of change in active workers (per minute)
rate(buntime_pool_active[1m])
```

### Uptime

```promql
# Uptime in hours
buntime_uptime_seconds / 3600

# Detect restarts (uptime drops to 0)
changes(buntime_uptime_seconds[1h])
```

## Alerting Rules

Create alerting rules for critical pool conditions:

```yaml
# alerts.yml
groups:
  - name: buntime_pool
    rules:
      # Pool utilization above 80% for 5 minutes
      - alert: BuntimeHighUtilization
        expr: buntime_pool_utilization > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Buntime pool utilization is {{ $value | humanizePercentage }}"
          description: "Pool utilization has been above 80% for 5 minutes on {{ $labels.instance }}"

      # Pool is fully exhausted
      - alert: BuntimePoolExhausted
        expr: buntime_pool_active >= buntime_pool_size
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Buntime worker pool is exhausted"
          description: "All {{ $value }} pool slots are in use on {{ $labels.instance }}"

      # No workers available
      - alert: BuntimeNoWorkers
        expr: buntime_pool_total == 0
        for: 30s
        labels:
          severity: critical
        annotations:
          summary: "Buntime has no workers"
          description: "Zero workers are running on {{ $labels.instance }}"

      # Instance restart detected
      - alert: BuntimeRestart
        expr: changes(buntime_uptime_seconds[5m]) > 0
        labels:
          severity: info
        annotations:
          summary: "Buntime instance restarted"
          description: "{{ $labels.instance }} restarted within the last 5 minutes"
```

## Grafana Setup

### 1. Add Prometheus Data Source

In Grafana, go to **Configuration > Data Sources > Add data source**:

- **Type**: Prometheus
- **URL**: `http://prometheus:9090`
- **Access**: Server (default)

### 2. Dashboard Panels

#### Pool Utilization Gauge

```
Panel: Gauge
Query: buntime_pool_utilization * 100
Unit: percent (0-100)
Thresholds:
  - 0-60: green
  - 60-80: yellow
  - 80-100: red
```

#### Active Workers Time Series

```
Panel: Time series
Query A: buntime_pool_active   (legend: Active)
Query B: buntime_pool_idle     (legend: Idle)
Query C: buntime_pool_creating (legend: Creating)
Stack: on
Unit: short
```

#### Pool Capacity Bar

```
Panel: Bar gauge
Query A: buntime_pool_active  (legend: Active)
Query B: buntime_pool_idle    (legend: Idle)
Query C: buntime_pool_size - buntime_pool_total  (legend: Available)
Max: buntime_pool_size
```

#### Utilization Over Time

```
Panel: Time series
Query: avg_over_time(buntime_pool_utilization[5m]) * 100
Unit: percent
Title: Pool Utilization (5m avg)
```

#### Uptime Stat

```
Panel: Stat
Query: buntime_uptime_seconds / 3600
Unit: hours
Title: Uptime
```

### 3. Example Dashboard JSON

Import this dashboard via **Dashboards > Import**:

```json
{
  "dashboard": {
    "title": "Buntime Pool Metrics",
    "panels": [
      {
        "title": "Pool Utilization",
        "type": "gauge",
        "targets": [
          { "expr": "buntime_pool_utilization * 100" }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "percent",
            "max": 100,
            "thresholds": {
              "steps": [
                { "value": 0, "color": "green" },
                { "value": 60, "color": "yellow" },
                { "value": 80, "color": "red" }
              ]
            }
          }
        },
        "gridPos": { "h": 8, "w": 6, "x": 0, "y": 0 }
      },
      {
        "title": "Workers",
        "type": "timeseries",
        "targets": [
          { "expr": "buntime_pool_active", "legendFormat": "Active" },
          { "expr": "buntime_pool_idle", "legendFormat": "Idle" },
          { "expr": "buntime_pool_creating", "legendFormat": "Creating" }
        ],
        "gridPos": { "h": 8, "w": 12, "x": 6, "y": 0 }
      },
      {
        "title": "Pool Size",
        "type": "stat",
        "targets": [
          { "expr": "buntime_pool_size" }
        ],
        "gridPos": { "h": 4, "w": 6, "x": 18, "y": 0 }
      },
      {
        "title": "Uptime (hours)",
        "type": "stat",
        "targets": [
          { "expr": "buntime_uptime_seconds / 3600" }
        ],
        "gridPos": { "h": 4, "w": 6, "x": 18, "y": 4 }
      }
    ]
  }
}
```

## Docker Compose Example

Complete monitoring stack with Docker Compose:

```yaml
# docker-compose.monitoring.yml
version: "3.8"

services:
  buntime:
    image: buntime:latest
    ports:
      - "8000:8000"
    # Ensure plugin-metrics is enabled with prometheus: true

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - ./alerts.yml:/etc/prometheus/alerts.yml
    command:
      - "--config.file=/etc/prometheus/prometheus.yml"
      - "--storage.tsdb.retention.time=30d"

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
    volumes:
      - grafana-data:/var/lib/grafana

volumes:
  grafana-data:
```

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - alerts.yml

scrape_configs:
  - job_name: buntime
    metrics_path: /metrics/api/metrics/prometheus
    static_configs:
      - targets: ['buntime:8000']
```

## Troubleshooting

### Prometheus Shows "Down" for Target

1. Verify Buntime is running and `plugin-metrics` is enabled
2. Check that `prometheus: true` is set in the manifest
3. Verify network connectivity: `curl http://buntime:8000/metrics/api/metrics/prometheus`
4. Check Prometheus logs for scrape errors

### Metrics Are Stale

1. Check `scrape_interval` in `prometheus.yml`
2. Verify the target is not timing out (increase `scrape_timeout`)
3. Check for network latency between Prometheus and Buntime

### Grafana Shows "No Data"

1. Verify the Prometheus data source is configured correctly in Grafana
2. Test the query directly in Prometheus expression browser
3. Check the time range in Grafana matches when data was collected

## Next Steps

- [API Reference](../api-reference.md) - Complete endpoint documentation
- [Configuration](configuration.md) - Plugin settings reference
- [Overview](../concepts/overview.md) - Architecture and metrics concepts
