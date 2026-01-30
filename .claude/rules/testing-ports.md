# Testing Ports

## Port Architecture

**ALWAYS test applications via port 8000 (runtime)**. Never test directly on example ports.

| Port Range | Type | Description |
|------------|------|-------------|
| 8000 | Runtime | Main buntime server with all plugins and admin dashboard |
| 5000-5999 | Examples | todos-htm (5000), todos-kv (5001), etc. |

## Why Port 8000?

The runtime (port 8000):
- Loads all plugins from `manifest.jsonc`
- Serves the admin dashboard (React app)
- Handles proxying/redirects to examples
- Provides plugin APIs (`/api/keyval/*`, `/api/metrics/*`, etc.)
- Manages worker pools and routing
- Injects `<base href>` for SPAs under subpaths

Examples running on their own ports (5000+) do NOT have access to plugins.

## Correct Testing Flow

```bash
# Start all services from project root
cd /home/user/Developer/zomme/buntime
bun dev

# Access applications via runtime (port 8000)
http://localhost:8000/              # Admin dashboard
http://localhost:8000/todos-kv      # NOT http://localhost:5001
```

## Prerequisites

The runtime requires libSQL for some plugins:

```bash
# Start libSQL before bun dev
docker compose up -d libsql

# Then start all services
bun dev
```

## Common Mistakes

- Testing on `localhost:5001` instead of `localhost:8000/todos-kv`
- Forgetting to start libSQL before runtime (causes plugin load failures)
- Not using the `base` option in proxy rules for SPAs (breaks routing)
