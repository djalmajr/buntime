# Configuration

Complete reference for all plugin-keyval configuration options.

## Configuration Methods

### manifest.yaml

Static plugin configuration:

```yaml
# plugins/plugin-keyval/manifest.yaml
name: "@buntime/plugin-keyval"
base: "/keyval"
enabled: true
injectBase: true

dependencies:
  - "@buntime/plugin-database"

entrypoint: dist/client/index.html
pluginEntry: dist/plugin.js

menus:
  - icon: lucide:database
    path: /keyval
    title: KeyVal
    items:
      - icon: lucide:home
        path: /keyval
        title: Overview
      - icon: lucide:list
        path: /keyval/entries
        title: Entries
      - icon: lucide:layers
        path: /keyval/queue
        title: Queue
      - icon: lucide:search
        path: /keyval/search
        title: Search
      - icon: lucide:eye
        path: /keyval/watch
        title: Watch
      - icon: lucide:atom
        path: /keyval/atomic
        title: Atomic
      - icon: lucide:activity
        path: /keyval/metrics
        title: Metrics

database: sqlite

metrics:
  persistent: false
  flushInterval: 30000

queue:
  cleanupInterval: 60000
  lockDuration: 30000
```

## Configuration Options

### database

Database adapter type to use for storage.

- **Type:** `AdapterType` (`"sqlite"`, `"libsql"`, `"postgres"`, etc.)
- **Default:** Default adapter from plugin-database

```yaml
database: sqlite
```

The adapter must be configured in `plugin-database`. KeyVal uses `database.getRootAdapter()` to get the adapter instance.

---

### metrics.persistent

Enable persistent metrics storage in the database.

- **Type:** `boolean`
- **Default:** `false`

```yaml
metrics:
  persistent: true
```

When enabled, metrics are periodically flushed to the database. This allows metrics to survive restarts and be queried historically.

When disabled, metrics are only kept in memory and reset on restart.

---

### metrics.flushInterval

Interval in milliseconds between metric flushes to the database.

- **Type:** `number`
- **Default:** `30000` (30 seconds)
- **Requires:** `metrics.persistent: true`

```yaml
metrics:
  persistent: true
  flushInterval: 60000  # Flush every 60 seconds
```

Lower values provide more granular metrics but increase database writes. Higher values reduce database load but may lose more data on crash.

---

### queue.cleanupInterval

Interval in milliseconds between queue cleanup runs.

- **Type:** `number`
- **Default:** `60000` (60 seconds)
- **Set to `0` to disable**

```yaml
queue:
  cleanupInterval: 30000  # Cleanup every 30 seconds
```

Cleanup operations:
- Reset stale locks (messages locked longer than `lockDuration`)
- Remove expired entries

---

### queue.lockDuration

Duration in milliseconds that a dequeued message remains locked.

- **Type:** `number`
- **Default:** `30000` (30 seconds)

```yaml
queue:
  lockDuration: 60000  # 60 second lock
```

When a message is dequeued, it's locked to prevent other consumers from processing it. If the consumer doesn't ack/nack within this duration, the message is automatically unlocked and returned to the pending state.

Set this to a value longer than your expected maximum processing time.

## Configuration Summary

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `database` | `AdapterType` | (default adapter) | Database adapter type |
| `metrics.persistent` | `boolean` | `false` | Persist metrics to database |
| `metrics.flushInterval` | `number` | `30000` | Metric flush interval (ms) |
| `queue.cleanupInterval` | `number` | `60000` | Queue cleanup interval (ms) |
| `queue.lockDuration` | `number` | `30000` | Message lock duration (ms) |

## Dependencies

Plugin-keyval requires `plugin-database` to be loaded:

```yaml
dependencies:
  - "@buntime/plugin-database"
```

The database plugin must have at least one adapter configured. If `database` is not specified in the keyval config, the default adapter from plugin-database is used.

## Complete Examples

### Minimal Configuration

```yaml
name: "@buntime/plugin-keyval"
enabled: true
database: sqlite
```

Uses all defaults: in-memory metrics, 60s cleanup, 30s lock.

### With Persistent Metrics

```yaml
name: "@buntime/plugin-keyval"
enabled: true
database: libsql

metrics:
  persistent: true
  flushInterval: 60000
```

### High-Throughput Queue

```yaml
name: "@buntime/plugin-keyval"
enabled: true
database: sqlite

queue:
  cleanupInterval: 10000   # Aggressive cleanup
  lockDuration: 120000     # 2 minute lock for long-running tasks
```

### Production Configuration

```yaml
name: "@buntime/plugin-keyval"
enabled: true
database: libsql

metrics:
  persistent: true
  flushInterval: 30000

queue:
  cleanupInterval: 60000
  lockDuration: 30000
```

### Minimal Queue Usage

```yaml
name: "@buntime/plugin-keyval"
enabled: true
database: sqlite

queue:
  cleanupInterval: 0  # Disable automatic cleanup
```

## Plugin API Configuration

When using plugin-keyval programmatically:

```typescript
import keyvalExtension from "@buntime/plugin-keyval";

export default keyvalExtension({
  database: "libsql",
  metrics: {
    persistent: true,
    flushInterval: 30000,
  },
  queue: {
    cleanupInterval: 60000,
    lockDuration: 30000,
  },
});
```

### TypeScript Interface

```typescript
interface KeyValConfig {
  database?: AdapterType;
  metrics?: {
    persistent?: boolean;
    flushInterval?: number;
  };
  queue?: {
    cleanupInterval?: number;
    lockDuration?: number;
  };
}
```

## UI Dashboard

When enabled, the plugin provides a web UI at `/keyval/` with pages for:

- **Overview** - Plugin status and statistics
- **Entries** - Browse, search, create, and delete KV entries
- **Queue** - Queue status, pending messages, DLQ management
- **Search** - Full-text search interface
- **Watch** - Real-time key change monitoring
- **Atomic** - Execute atomic operations
- **Metrics** - Operation counters and charts

The menu structure is defined in `manifest.yaml` under the `menus` key.

## Next Steps

- [Overview](../concepts/overview.md) - Architecture and components
- [Where Filters](where-filters.md) - Filter operators
- [API Reference](../api-reference.md) - Complete endpoint reference
