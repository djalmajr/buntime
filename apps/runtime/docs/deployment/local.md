# Local Deployment

There are three ways to run Buntime locally:

| Mode | Command | Use Case | Size |
|------|---------|----------|------|
| Development | `bun dev` | Hot reload, debugging | N/A |
| Bundle | `bun run index.ts` | Production-like, requires Bun | ~1.5MB |
| Compiled | `./buntime` | Standalone binary, no dependencies | ~130MB |

# Development Mode

```bash
cd runtime
bun dev
```

Features:

- Hot reload on file changes
- Source maps for debugging
- Slower startup (plugins loaded from node_modules)

# Bundle Mode

Compile and run the bundled JavaScript:

```bash
cd runtime

# Build bundle
bun run build

# Run with Bun
bun run dist/index.ts
```

Output structure:

```
dist/
├── index.ts       # Main bundle (~1.3MB)
└── wrapper.ts     # Worker thread (~23KB)
```

# Compiled Binary

Compile a standalone executable with all dependencies embedded:

```bash
cd runtime

# Build binary
bun run build:bin

# Run directly
./dist/buntime
```

Output:

```
dist/
└── buntime        # Standalone binary (~130MB)
```

## Compiled Mode Features

- Doesn't require Bun installation
- All plugins embedded in binary
- Single file deployment
- Works on any Linux x64 system

## Compiled Mode Configuration

The binary is configured via environment variables:

```bash
# Option 1: Run with env vars
RUNTIME_WORKER_DIRS=/apps RUNTIME_PLUGIN_DIRS=/plugins ./dist/buntime

# Option 2: Use .env file
cd /opt/buntime
cp .env.example .env  # Configure env vars
./buntime
```

## Environment Variables

```bash
# Required
export RUNTIME_WORKER_DIRS=/path/to/apps

# Optional (defaults: PORT=8000, RUNTIME_POOL_SIZE=500 for prod)
export PORT=8000
export RUNTIME_POOL_SIZE=500
export RUNTIME_LOG_LEVEL=info

# Run
./buntime
```

## Systemd Service

Create `/etc/systemd/system/buntime.service`:

```ini
[Unit]
Description=Buntime Runtime
After=network.target

[Service]
Type=simple
User=buntime
Group=buntime
WorkingDirectory=/opt/buntime
ExecStart=/opt/buntime/buntime
Restart=always
RestartSec=5

Environment=PORT=8000
Environment=RUNTIME_WORKER_DIRS=/opt/buntime/apps
Environment=RUNTIME_LOG_LEVEL=info

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable buntime
sudo systemctl start buntime
sudo systemctl status buntime
```

# Docker

## Build Image

```bash
# From project root
docker build -t buntime:latest .
```

## Run Container

```bash
docker run -d \
  --name buntime \
  -p 8000:8000 \
  -v /path/to/apps:/app/apps \
  -e RUNTIME_WORKER_DIRS=/app/apps \
  buntime:latest
```

## Docker Compose

```yaml
services:
  buntime:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8001:8000"
    volumes:
      - ./tmp:/app/apps
    environment:
      PORT: 8000
      RUNTIME_WORKER_DIRS: /app/apps
    depends_on:
      libsql:
        condition: service_healthy
    restart: unless-stopped

  libsql:
    image: ghcr.io/tursodatabase/libsql-server:latest
    ports:
      - "8880:8080"  # HTTP API
      - "8881:5001"  # gRPC API (for replication)
    volumes:
      - libsql-data:/var/lib/sqld
    environment:
      SQLD_NODE: primary
      SQLD_HTTP_LISTEN_ADDR: 0.0.0.0:8080
      SQLD_GRPC_LISTEN_ADDR: 0.0.0.0:5001
      SQLD_DISABLE_AUTH: "true"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped

  libsql-replica:
    image: ghcr.io/tursodatabase/libsql-server:latest
    ports:
      - "8882:8080"  # HTTP API (replica)
    volumes:
      - libsql-replica-data:/var/lib/sqld
    environment:
      SQLD_NODE: replica
      SQLD_PRIMARY_URL: http://libsql:5001
      SQLD_HTTP_LISTEN_ADDR: 0.0.0.0:8080
      SQLD_DISABLE_AUTH: "true"
    depends_on:
      libsql:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped

volumes:
  libsql-data:
  libsql-replica-data:
```

> [!NOTE]
> The docker-compose.yml uses `build:` to build the image locally. For production, you can replace with `image: ghcr.io/zommehq/buntime:latest`.

# Comparison

| Feature | Dev | Bundle | Compiled | Docker |
|---------|-----|--------|----------|--------|
| Hot Reload | Yes | No | No | No |
| Requires Bun | Yes | Yes | No | No |
| Deploy Size | N/A | ~1.5MB + Bun | ~130MB | ~132MB |
| Startup Time | Slow | Fast | Fast | Fast |
| Plugins From | node_modules | Embedded | Embedded | Embedded |
