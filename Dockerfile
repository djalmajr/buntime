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

# Build plugins (NODE_ENV=production prevents watch mode in bun-plugin-tsr)
RUN NODE_ENV=production bun run --filter '@buntime/plugin-*' build

# Build cpanel (default worker app)
WORKDIR /build/apps/cpanel
RUN NODE_ENV=production bun run build

# Build the compiled binary
WORKDIR /build/apps/runtime
RUN NODE_ENV=production bun scripts/build.ts --compile

# Prepare clean plugin output (manifest.jsonc + dist only, skip disabled plugins without dist)
WORKDIR /build
RUN for plugin in plugins/plugin-*; do \
      name=$(basename "$plugin"); \
      if [ -d "$plugin/dist" ]; then \
        mkdir -p /output/plugins/"$name"; \
        cp "$plugin/manifest.jsonc" /output/plugins/"$name"/; \
        cp -r "$plugin/dist" /output/plugins/"$name"/; \
      fi; \
    done

# =============================================================================
# Stage 2: Runtime (Debian Slim - minimal with glibc)
# =============================================================================
FROM debian:bookworm-slim

WORKDIR /app

# Copy the binary
COPY --from=builder /build/apps/runtime/dist/buntime /app/buntime

# Copy core plugins to hidden .plugins directory (updated with image)
COPY --from=builder /output/plugins/ /data/.plugins/

# Copy cpanel to hidden .apps directory (not visible in deployments UI)
COPY --from=builder /build/apps/cpanel/dist/ /data/.apps/cpanel/dist/
COPY --from=builder /build/apps/cpanel/manifest.jsonc /data/.apps/cpanel/

# Default environment variables (aligned with Helm chart values.yaml)
# .apps/.plugins = core (from image), apps/plugins = custom (from PVC)
ENV WORKER_DIRS=/data/.apps,/data/apps
ENV PLUGIN_DIRS=/data/.plugins,/data/plugins

EXPOSE 8000

CMD ["/app/buntime"]
