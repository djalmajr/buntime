# Multi-stage build for Buntime runtime
# Run from monorepo root: docker build -t buntime .

# =============================================================================
# Stage 1: Build
# =============================================================================
FROM oven/bun:1.3 AS builder

WORKDIR /build

# Copy workspace config
COPY package.json bun.lock* ./
COPY tsconfig.json ./

# Copy all workspace packages
COPY packages/ ./packages/
COPY plugins/ ./plugins/
COPY apps/ ./apps/
COPY runtime/ ./runtime/

# Install dependencies
RUN bun install

# Build the compiled binary
WORKDIR /build/runtime

RUN NODE_ENV=production bun scripts/build.ts --compile

# Build cpanel app
WORKDIR /build/apps/cpanel@latest
RUN NODE_ENV=production bun run build

# Build all builtin plugins (they are only enabled via manifest.jsonc)
WORKDIR /build/plugins/plugin-authn
RUN NODE_ENV=production bun run build

WORKDIR /build/plugins/plugin-authz
RUN NODE_ENV=production bun run build

WORKDIR /build/plugins/plugin-database
RUN NODE_ENV=production bun run build

WORKDIR /build/plugins/plugin-deployments
RUN NODE_ENV=production bun run build

WORKDIR /build/plugins/plugin-durable
RUN NODE_ENV=production bun run build

WORKDIR /build/plugins/plugin-gateway
RUN NODE_ENV=production bun run build

WORKDIR /build/plugins/plugin-health
RUN NODE_ENV=production bun run build

WORKDIR /build/plugins/plugin-keyval
RUN NODE_ENV=production bun run build

WORKDIR /build/plugins/plugin-logs
RUN NODE_ENV=production bun run build

WORKDIR /build/plugins/plugin-metrics
RUN NODE_ENV=production bun run build

WORKDIR /build/plugins/plugin-proxy
RUN NODE_ENV=production bun run build

# =============================================================================
# Stage 2: Runtime (minimal)
# =============================================================================
FROM gcr.io/distroless/cc-debian12

WORKDIR /app

# Distroless already includes ca-certificates

# Copy the binary (config provided via Helm ConfigMap or volume mount)
COPY --from=builder /build/runtime/dist/buntime /app/buntime

# Copy built apps
COPY --from=builder /build/apps/cpanel@latest/dist /app/apps/cpanel@latest/dist
COPY --from=builder /build/apps/cpanel@latest/package.json /app/apps/cpanel@latest/package.json

# Copy built plugins (for fragment UI serving in compiled mode)
# Client files go to root so pool.fetch finds index.html
# Only copy plugins that have client UI (dist/client with index.html)
COPY --from=builder /build/plugins/plugin-authn/dist/client /app/plugins/authn
COPY --from=builder /build/plugins/plugin-authz/dist/client /app/plugins/authz
COPY --from=builder /build/plugins/plugin-database/dist/client /app/plugins/database
COPY --from=builder /build/plugins/plugin-deployments/dist/client /app/plugins/deployments
COPY --from=builder /build/plugins/plugin-durable/dist/client /app/plugins/durable
COPY --from=builder /build/plugins/plugin-gateway/dist/client /app/plugins/gateway
COPY --from=builder /build/plugins/plugin-health/dist/client /app/plugins/health
COPY --from=builder /build/plugins/plugin-keyval/dist/client /app/plugins/keyval
COPY --from=builder /build/plugins/plugin-logs/dist/client /app/plugins/logs
COPY --from=builder /build/plugins/plugin-metrics/dist/client /app/plugins/metrics
COPY --from=builder /build/plugins/plugin-proxy/dist/client /app/plugins/proxy

EXPOSE 8000

CMD ["/app/buntime"]
