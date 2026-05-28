# Multi-stage build for Buntime runtime
# Run from monorepo root: docker build -t buntime .

# =============================================================================
# Stage 1: Build
# =============================================================================
FROM oven/bun:1.3.12 AS builder

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

# Build the shell app-shell (served at root). todos is a static SPA (no build).
# `platform` is NOT baked: it needs per-deploy secrets via a worker `.env`, so it
# is installed to the writable /data/apps PVC at deploy time. See wiki:
# apps/multi-tenant-platform.
WORKDIR /build/apps/shell
RUN NODE_ENV=production bun run build
WORKDIR /build

# Build the runtime bundle (NOT --compile: `bun build --compile` cannot embed
# NAPI native bindings like `@tursodatabase/database-<platform>-<arch>` into
# bunfs. We ship the bundled JS plus the on-disk node_modules so bun resolves
# the matching platform binding at startup.
WORKDIR /build/apps/runtime
RUN NODE_ENV=production bun scripts/build.ts

# Prepare clean plugin output (manifest.yaml + dist only, skip disabled plugins without dist)
WORKDIR /build
RUN for plugin in plugins/plugin-*; do \
      name=$(basename "$plugin"); \
      if [ -d "$plugin/dist" ]; then \
        mkdir -p /output/plugins/"$name"; \
        cp "$plugin/manifest.yaml" /output/plugins/"$name"/; \
        cp -r "$plugin/dist" /output/plugins/"$name"/; \
      fi; \
    done

# =============================================================================
# Stage 2: Runtime (Bun slim — keeps bun available for native module loading)
# =============================================================================
FROM oven/bun:1.3.12-slim

# Install system dependencies (zip/unzip for download-batch endpoint)
RUN apt-get update && apt-get install -y --no-install-recommends \
    zip \
    unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace layout from builder.
#
# Bun's workspace install creates symlinks like:
#   apps/runtime/node_modules/@tursodatabase/database
#     -> ../../../../node_modules/.bun/@tursodatabase+database@0.5.3/node_modules/@tursodatabase/database
# and the platform-specific native binding lives at:
#   node_modules/.bun/@tursodatabase+database-linux-arm64-gnu@0.5.3/node_modules/@tursodatabase/database-linux-arm64-gnu
# Preserving the relative directory layout keeps every symlink valid.
COPY --from=builder /build/package.json /build/tsconfig.json ./
COPY --from=builder /build/bun.lock* ./
COPY --from=builder /build/packages ./packages
COPY --from=builder /build/apps/runtime/dist ./apps/runtime/dist
COPY --from=builder /build/apps/runtime/package.json ./apps/runtime/package.json
COPY --from=builder /build/apps/runtime/node_modules ./apps/runtime/node_modules
COPY --from=builder /build/node_modules ./node_modules

# Copy core plugins to hidden .plugins directory (updated with image)
COPY --from=builder /output/plugins/ /data/.plugins/

# Copy cpanel to hidden .apps directory (not visible in deployments UI)
COPY --from=builder /build/apps/cpanel/dist/ /data/.apps/cpanel/dist/
COPY --from=builder /build/apps/cpanel/manifest.yaml /data/.apps/cpanel/

# Multi-tenant reference apps baked into the image: shell (served at root via the
# gateway app-shell) and todos (static, loaded in a z-frame). `platform` is NOT
# baked — it carries per-deploy secrets via a worker `.env`, so it is installed to
# the writable /data/apps PVC at deploy time. The deploy sets
# GATEWAY_SHELL_DIR=/data/.apps/shell and GATEWAY_SHELL_EXCLUDES=cpanel,todos,platform.
COPY --from=builder /build/apps/shell/dist/ /data/.apps/shell/dist/
COPY --from=builder /build/apps/shell/manifest.yaml /data/.apps/shell/
COPY --from=builder /build/apps/todos/ /data/.apps/todos/

# Default environment variables (aligned with Helm chart values.yaml)
# .apps/.plugins = core (from image), apps/plugins = custom (from PVC)
ENV RUNTIME_WORKER_DIRS=/data/.apps:/data/apps
ENV RUNTIME_PLUGIN_DIRS=/data/.plugins:/data/plugins
ENV NODE_ENV=production

EXPOSE 8000

CMD ["bun", "apps/runtime/dist/index.ts"]
