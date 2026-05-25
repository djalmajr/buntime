# Compact image used by the buntime turso-backup CronJob.
#
# Bundles:
#   - busybox-style coreutils (sh, awk, sort, tail, date)
#   - curl (HTTP client for /v1/namespaces/:name/backup)
#   - mc (MinIO client for pipe-into-S3)
#   - jq (parsing the namespace list returned by the admin API)
#
# Built on alpine:3.21 because the official `minio/mc` image is shell-less
# and the standard alpine repo packages already cover everything else we
# need. Image ends up around ~30MB, mostly the mc binary.
ARG TARGETARCH=arm64

FROM alpine:3.21

RUN apk add --no-cache ca-certificates curl jq bash

# Fetch the matching mc release. dl.min.io publishes both `linux-amd64`
# and `linux-arm64`. Docker buildx exposes the target arch via the
# `TARGETARCH` build arg.
ARG TARGETARCH
RUN ARCH="$TARGETARCH" && \
    case "$ARCH" in \
      amd64) MC_ARCH=linux-amd64 ;; \
      arm64) MC_ARCH=linux-arm64 ;; \
      *) echo "unsupported arch $ARCH" && exit 1 ;; \
    esac && \
    wget -O /usr/local/bin/mc "https://dl.min.io/client/mc/release/${MC_ARCH}/mc" && \
    chmod +x /usr/local/bin/mc

ENV MC_CONFIG_DIR=/tmp/mc

WORKDIR /work
ENTRYPOINT ["/bin/sh", "-c"]
