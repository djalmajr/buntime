# turso-server: multi-tenant wrapper around `tursodb --sync-server`.
#
# Build context is the repo root (../..) so the Dockerfile can also be built
# from there:  docker build -f apps/turso-server/Dockerfile .
# Or from this directory:  docker build .
#
# Defaults to fetching the official tursodb binary from the v0.6.0 GitHub
# release. Override TURSODB_VERSION / TURSODB_ARCH at build time:
#
#   docker build --build-arg TURSODB_VERSION=v0.6.0 \
#                --build-arg TURSODB_ARCH=aarch64-unknown-linux-gnu \
#                -t turso-server .

ARG TURSODB_VERSION=v0.6.0
ARG TURSODB_ARCH=aarch64-unknown-linux-gnu

# =============================================================================
# Stage 1: Go build
# =============================================================================
FROM golang:1.26-alpine AS gobuild
WORKDIR /src

COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true

COPY . .
RUN CGO_ENABLED=0 GOOS=linux \
    go build -trimpath -ldflags="-s -w" -o /out/turso-server .

# =============================================================================
# Stage 2: tursodb fetch
# =============================================================================
#
# Use debian here too — the upstream tursodb is glibc-linked; an alpine-based
# stage cannot run `tursodb --help` to verify the binary downloaded cleanly
# (exit 127 / loader missing). Debian costs ~30 MB more in the intermediate
# stage but the final image consumes only the binary itself.
FROM debian:bookworm-slim AS tursodb
ARG TURSODB_VERSION
ARG TURSODB_ARCH

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Pull the release tarball and extract just the binary. We do not verify the
# sha256 here because the release upload includes a sidecar `.sha256` we can
# consume in the future if we want stronger supply-chain assurance.
RUN curl -fsSL -o /tmp/turso.tar.xz \
      "https://github.com/tursodatabase/turso/releases/download/${TURSODB_VERSION}/turso_cli-${TURSODB_ARCH}.tar.xz" && \
    tar -xJf /tmp/turso.tar.xz -C /tmp && \
    mv "/tmp/turso_cli-${TURSODB_ARCH}/tursodb" /usr/local/bin/tursodb && \
    chmod +x /usr/local/bin/tursodb && \
    /usr/local/bin/tursodb --help >/dev/null && \
    rm -rf /tmp/turso*

# =============================================================================
# Stage 3: Runtime
# =============================================================================
#
# Debian slim (not alpine) because the upstream tursodb binary is dynamically
# linked against glibc and needs the GNU dynamic loader. The release artifact
# we consume is the `aarch64-unknown-linux-gnu` variant — using `musl` here
# would skip the loader and the binary would fail with "no such file".
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=tursodb /usr/local/bin/tursodb /usr/local/bin/tursodb
COPY --from=gobuild /out/turso-server /usr/local/bin/turso-server

RUN mkdir -p /var/lib/turso && \
    addgroup --system --gid 9000 turso && \
    adduser  --system --uid 9000 --gid 9000 --home /var/lib/turso --no-create-home turso && \
    chown -R turso:turso /var/lib/turso

USER turso
WORKDIR /var/lib/turso

ENV TURSO_DATA_DIR=/var/lib/turso \
    TURSODB_BIN=/usr/local/bin/tursodb \
    TURSO_DATA_ADDR=:8080 \
    TURSO_ADMIN_ADDR=:8081

EXPOSE 8080 8081

ENTRYPOINT ["/usr/local/bin/turso-server"]
