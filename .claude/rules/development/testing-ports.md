# Testing Ports

## Port Architecture

**ALWAYS test applications via port 8000 (runner)**. Never test directly on app/example ports.

| Port Range | Type | Description |
|------------|------|-------------|
| 8000 | Runner | Main buntime server with all plugins loaded |
| 4000-4999 | Apps | CPanel (4000), Coder (4001), etc. |
| 5000-5999 | Examples | todos-htm (5000), todos-kv (5001), playground (5002) |

## Why Port 8000?

The runner (port 8000):
- Loads all plugins from `buntime.jsonc`
- Handles proxying/redirects to apps and examples
- Provides plugin APIs (`/_/plugin-keyval/*`, `/_/plugin-metrics/*`, etc.)
- Manages worker pools and routing

Apps and examples running on their own ports (4000+, 5000+) do NOT have access to plugins.

## Correct Testing Flow

```bash
# Start all services from project root
cd /home/user/Developer/zomme/buntime
bun dev

# Access applications via runner (port 8000)
http://localhost:8000/playground    # NOT http://localhost:5002
http://localhost:8000/cpanel        # NOT http://localhost:4000
http://localhost:8000/coder         # NOT http://localhost:4001
```

## Prerequisites

The runner requires libSQL for some plugins:

```bash
# Start libSQL before bun dev
docker compose up -d libsql

# Then start all services
bun dev
```

## Common Mistakes

- Testing on `localhost:5002/keyval` instead of `localhost:8000/playground/keyval`
- Testing on `localhost:4000` instead of `localhost:8000/cpanel`
- Forgetting to start libSQL before runner (causes plugin load failures)
