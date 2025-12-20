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

# =============================================================================
# Stage 2: Runtime (minimal)
# =============================================================================
FROM gcr.io/distroless/cc-debian12

WORKDIR /app

# Distroless already includes ca-certificates

# Copy the binary and config
COPY --from=builder /build/runtime/dist/buntime /app/buntime
COPY --from=builder /build/runtime/dist/buntime.jsonc /app/buntime.jsonc

# Copy built apps
COPY --from=builder /build/apps/cpanel@latest/dist /app/apps/cpanel@latest/dist
COPY --from=builder /build/apps/cpanel@latest/package.json /app/apps/cpanel@latest/package.json

EXPOSE 8000

CMD ["/app/buntime"]
