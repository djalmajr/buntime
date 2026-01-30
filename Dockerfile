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

# Install dependencies
RUN bun install

# Build plugins
RUN bun run --filter '@buntime/plugin-*' build

# Build cpanel (default worker app)
WORKDIR /build/apps/cpanel
RUN bun run build

# Build the compiled binary
WORKDIR /build/apps/runtime
RUN NODE_ENV=production bun scripts/build.ts --compile

# Prepare clean plugin output (manifest.jsonc + dist only)
WORKDIR /build
RUN for plugin in plugins/plugin-*; do \
      name=$(basename "$plugin"); \
      mkdir -p /output/plugins/"$name"; \
      cp "$plugin/manifest.jsonc" /output/plugins/"$name"/; \
      cp -r "$plugin/dist" /output/plugins/"$name"/; \
    done

# =============================================================================
# Stage 2: Runtime (minimal)
# =============================================================================
FROM gcr.io/distroless/cc-debian12

WORKDIR /app

# Copy the binary
COPY --from=builder /build/apps/runtime/dist/buntime /app/buntime

# Copy plugins (manifest.jsonc + dist only)
COPY --from=builder /output/plugins/ /data/plugins/

# Copy cpanel as default worker (aligned with Helm chart: /data/apps)
COPY --from=builder /build/apps/cpanel/dist/ /data/apps/cpanel/dist/
COPY --from=builder /build/apps/cpanel/manifest.jsonc /data/apps/cpanel/

# Default environment variables (aligned with Helm chart values.yaml)
ENV WORKER_DIRS=/data/apps
ENV PLUGIN_DIRS=/data/plugins

EXPOSE 8000

CMD ["/app/buntime"]
