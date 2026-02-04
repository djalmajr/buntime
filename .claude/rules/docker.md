---
name: docker
summary: |
  - Dockerfile (prod): multi-stage build, compiled binary
  - Dockerfile.dev: hot reload with source mounted
  - docker-compose profiles: --profile dev or --profile prod
  - LibSQL runs as dependent service
  - Volumes: apps, plugins from env vars or defaults
  - Port 8000 exposed
---

# Docker Guide

## Dockerfiles

| File | Purpose | Image Size | Hot Reload |
|------|---------|------------|------------|
| `Dockerfile` | Production | Small (compiled binary) | No |
| `Dockerfile.dev` | Development | Larger (full Bun + source) | Yes |

## Docker Compose Profiles

```bash
# Development (hot reload, source mounted)
docker-compose --profile dev up

# Production (compiled binary)
docker-compose --profile prod up

# With rebuild
docker-compose --profile dev up --build
```

## Services

### buntime-dev / buntime-prod

Main runtime service.

**Ports:**
- `8000:8000` - HTTP API

**Volumes (dev):**
```yaml
volumes:
  # Source code for hot reload
  - ./packages:/build/packages
  - ./apps:/build/apps
  - ./plugins:/build/plugins
  # Core apps/plugins (symlinked)
  - ./apps:/data/.apps
  - ./plugins:/data/.plugins
  # External apps/plugins (from env)
  - ${RUNTIME_WORKER_DIRS:-./tmp/apps}:/data/apps
  - ${RUNTIME_PLUGIN_DIRS:-./tmp/plugins}:/data/plugins
  # App shell
  - ${GATEWAY_APP_SHELL:-/tmp/apps/example-spa}:/data/apps/example-spa
```

**Environment:**
```yaml
environment:
  NODE_ENV: development
  PORT: 8000
  RUNTIME_API_PREFIX: /_
  RUNTIME_LOG_LEVEL: debug
  RUNTIME_PLUGIN_DIRS: /data/.plugins:/data/plugins
  RUNTIME_WORKER_DIRS: /data/.apps:/data/apps
  RUNTIME_POOL_SIZE: 10
  DATABASE_LIBSQL_URL: http://libsql:8080
  GATEWAY_APP_SHELL: /data/apps/example-spa
```

### libsql

LibSQL database service.

**Ports:**
- `8880:8080` - HTTP API
- `8881:5001` - gRPC (replication)

**Environment:**
```yaml
environment:
  SQLD_NODE: primary
  SQLD_HTTP_LISTEN_ADDR: 0.0.0.0:8080
  SQLD_GRPC_LISTEN_ADDR: 0.0.0.0:5001
  SQLD_DISABLE_AUTH: "true"  # Dev only!
```

## Environment Variables (.env)

```bash
# .env file (loaded by docker-compose)
RUNTIME_PLUGIN_DIRS=/path/to/external/plugins
RUNTIME_WORKER_DIRS=/path/to/external/apps
GATEWAY_APP_SHELL=/path/to/example-spa
```

## Common Commands

```bash
# Start dev environment
docker-compose --profile dev up

# Start in background
docker-compose --profile dev up -d

# View logs
docker-compose --profile dev logs -f buntime

# Rebuild after Dockerfile changes
docker-compose --profile dev up --build

# Stop all services
docker-compose --profile dev down

# Stop and remove volumes
docker-compose --profile dev down -v

# Shell into container
docker exec -it buntime sh

# Check container status
docker ps
```

## Building Images Manually

```bash
# Production image
docker build -t buntime:latest .

# Development image
docker build -t buntime:dev -f Dockerfile.dev .

# With specific tag
docker build -t ghcr.io/zommehq/buntime:v1.0.0 .
```

## Volume Mapping

| Container Path | Purpose | Source |
|----------------|---------|--------|
| `/data/.apps` | Core apps (image) | Built-in |
| `/data/.plugins` | Core plugins (image) | Built-in |
| `/data/apps` | External apps | `RUNTIME_WORKER_DIRS` or volume |
| `/data/plugins` | External plugins | `RUNTIME_PLUGIN_DIRS` or volume |
| `/build/*` | Source code (dev only) | Local mounts |

## Troubleshooting

### Container won't start

```bash
# Check logs
docker-compose --profile dev logs buntime

# Check if port is in use
lsof -i :8000
```

### LibSQL connection failed

```bash
# Check libsql is running
docker-compose --profile dev ps

# Test libsql directly
curl http://localhost:8880/health
```

### Hot reload not working

1. Check volumes are mounted correctly
2. Ensure `NODE_ENV=development`
3. Check file permissions

### Permission issues

```bash
# Fix ownership (Linux)
sudo chown -R $USER:$USER ./tmp
```
