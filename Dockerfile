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

# =============================================================================
# Stage 2: Runtime (minimal)
# =============================================================================
FROM gcr.io/distroless/cc-debian12

WORKDIR /app

# Copy only the binary (apps/plugins installed via buntime-cli)
COPY --from=builder /build/runtime/dist/buntime /app/buntime

EXPOSE 8000

CMD ["/app/buntime"]
