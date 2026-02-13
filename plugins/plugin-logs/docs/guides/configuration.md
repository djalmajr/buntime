# Configuration

Complete reference for all plugin-logs configuration options.

## Configuration Method

### manifest.yaml

Static plugin configuration:

```yaml
# plugins/plugin-logs/manifest.yaml
name: "@buntime/plugin-logs"
base: "/logs"
enabled: false
injectBase: true

entrypoint: dist/client/index.html
pluginEntry: dist/plugin.js

menus:
  - icon: lucide:scroll-text
    path: /logs
    title: Logs

maxEntries: 1000
sseInterval: 1000
```

## Configuration Options

### maxEntries

Maximum number of log entries stored in the ring buffer. When capacity is reached, the oldest entries are automatically evicted.

- **Type:** `number`
- **Default:** `1000`
- **Min:** `1`

**Example:**
```yaml
maxEntries: 5000
```

**Memory considerations:**

| maxEntries | Approximate Memory | Use Case |
|------------|-------------------|----------|
| `100` | ~50 KB | Minimal footprint, recent events only |
| `1000` | ~500 KB | Default, good for most setups |
| `5000` | ~2.5 MB | High-traffic environments |
| `10000` | ~5 MB | Extended log retention |

> Memory estimates assume ~500 bytes per log entry (message + metadata). Actual usage depends on the size of `meta` objects.

**Behavior:**
```
maxEntries = 1000

After 1000th entry:
  Ring buffer is full.

After 1001st entry:
  Entry #1 is evicted.
  Entry #1001 takes its place.

Stats track ALL entries ever added (not just those in buffer).
```

---

### sseInterval

Interval in milliseconds between SSE event pushes. Controls how frequently connected clients receive updates.

- **Type:** `number`
- **Default:** `1000`
- **Unit:** milliseconds

**Example:**
```yaml
sseInterval: 500
```

**Trade-offs:**

| sseInterval | Update Rate | CPU/Network | Use Case |
|------------|-------------|-------------|----------|
| `250` | 4 per second | Higher | Real-time monitoring dashboards |
| `500` | 2 per second | Moderate | Active debugging |
| `1000` | 1 per second | Low (default) | General monitoring |
| `5000` | Every 5 seconds | Minimal | Background monitoring |

> Lower intervals mean more frequent updates but higher CPU and network usage, especially with many concurrent SSE clients.

---

## Complete Examples

### Local Development

Fast updates with generous buffer for debugging:

```yaml
name: "@buntime/plugin-logs"
base: "/logs"
enabled: true

maxEntries: 5000
sseInterval: 250
```

### Production - Low Resource

Minimal footprint for resource-constrained environments:

```yaml
name: "@buntime/plugin-logs"
base: "/logs"
enabled: true

maxEntries: 500
sseInterval: 5000
```

### Production - High Traffic

Extended retention for busy services:

```yaml
name: "@buntime/plugin-logs"
base: "/logs"
enabled: true

maxEntries: 10000
sseInterval: 1000
```

### Disabled (Default)

The plugin is disabled by default and must be explicitly enabled:

```yaml
name: "@buntime/plugin-logs"
enabled: false
```

## Validation

### Verify Configuration

```bash
# Check stats to verify maxEntries capacity
curl http://localhost:8000/logs/api/stats
```

```json
{
  "total": 0,
  "debug": 0,
  "info": 0,
  "warn": 0,
  "error": 0
}
```

### Verify SSE Interval

```bash
# Observe SSE event timing
curl -N http://localhost:8000/logs/api/sse 2>&1 | while read line; do
  echo "$(date +%H:%M:%S.%N) $line"
done
```

Events should arrive at the configured interval.

### Load Test Ring Buffer

```bash
# Add entries to test eviction
for i in $(seq 1 1100); do
  curl -s -X POST http://localhost:8000/logs/api/ \
    -H "Content-Type: application/json" \
    -d "{\"level\": \"info\", \"message\": \"Test entry $i\"}" > /dev/null
done

# Check stats - total should be 1100, but buffer holds maxEntries
curl http://localhost:8000/logs/api/stats
```

```json
{
  "total": 1100,
  "debug": 0,
  "info": 1100,
  "warn": 0,
  "error": 0
}
```

## Programmatic Configuration

The log service can be configured programmatically from other plugins via the service layer:

```typescript
// This is handled internally by the plugin during onInit
import { configure } from "./server/services";

configure({
  maxEntries: 5000,
  sseInterval: 500,
});
```

In practice, configuration is read from `manifest.yaml` during `onInit` and passed to the service layer. There is no runtime API to change configuration.

## Next Steps

- [API Reference](../api-reference.md) - Complete endpoint documentation
- [Overview](../concepts/overview.md) - Architecture and features
