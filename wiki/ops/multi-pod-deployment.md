---
title: "Multi-pod deployment (self-hosted)"
audience: ops
sources:
  - charts/values.base.yaml
  - charts/templates/statefulset.yaml
  - charts/templates/turso-server.yaml
  - charts/templates/turso-server-backup-cronjob.yaml
  - apps/turso-server/
  - packages/shared/src/api-keys.ts
updated: 2026-05-21
tags: [k8s, helm, multi-pod, turso, sqlite, backup, minio]
status: stable
---

# Multi-pod deployment (self-hosted)

Buntime runs single-pod out of the box. Scaling to multi-pod
(`replicaCount > 1`) requires the in-cluster **turso-server**
(`apps/turso-server`) — our Go supervisor that wraps `tursodb` and
exposes the namespace lifecycle semantics of `sqld`. All runtime pods
sync against it. The premise here is **fully self-hosted** — no managed
Turso Cloud.

> Looking for the implementation details? See
> [`wiki/ops/turso-server.md`](./turso-server.md) for the wrapper itself
> (Go binary, admin REST, GC, backup endpoint). This page is the
> operator-facing recipe.

## Why turso-server is needed

Each runtime pod opens **embedded replicas** of every Turso database it
consumes:

- `ApiKeyStore` → namespace `api-keys` (control plane).
- `plugin-turso` (via `TursoService.connect(name)`) → one namespace per
  plugin / app (`runtime`, `gateway`, `proxy`, `keyval`, `<app>` …).

The replicas live in `/data/state/api-keys.db` and
`/data/turso/<name>.db` inside each pod. Reads stay local (fast,
O(log n)). Writes funnel to a single writer per namespace — the
matching `tursodb` process inside `turso-server`. Without a server,
two pods writing the same key concurrently would produce conflicting
WAL state.

> SQLite WAL over NFS/RWX is **not safe** (POSIX fcntl locks on NFS
> are flakey, `.db-shm` mmap doesn't work correctly). That is why we
> move the writer into a dedicated server, not share a `.db` file
> across pods.

`tursodb` 0.6.0 itself serves one database per process; the Go wrapper
supervises one `tursodb` subprocess per namespace and proxies clients
into them by URL path. Namespaces are created **dynamically** on
first connect — apps installed via the lowcode platform get their own
isolated database without operator intervention.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                  Kubernetes namespace                               │
│                                                                     │
│  ┌──────────────────────────────┐    ┌──────────────────────────────┐
│  │ buntime-turso-0              │    │ buntime-0  buntime-1  …      │
│  │ (StatefulSet, 1 replica)     │    │ (StatefulSet, N replicas)    │
│  │                              │    │                              │
│  │ container: turso-server (Go) │    │ Each pod:                    │
│  │  - data port :8080  (proxy)  │    │  - Runtime + workers         │
│  │  - admin port :8081 (REST)   │    │  - ApiKeyStore embedded      │
│  │  - GC goroutine              │    │    → /api-keys               │
│  │  - 1 tursodb subprocess per  │◀───┤  - plugin-turso embedded     │
│  │    namespace (internal       │    │    → /<plugin>, /<app>, …    │
│  │    ports 9000-9999)          │    │                              │
│  │                              │    │ /data/state/api-keys.db (RWO)│
│  │ /var/lib/turso (RWO PVC):    │    │ /data/turso/<name>.db        │
│  │   api-keys.db                │    │   (emptyDir, per-namespace)  │
│  │   runtime.db                 │    │ /data/plugins (shared)       │
│  │   <plugin>.db                │    │ /data/apps    (shared)       │
│  │   <app>.db ...               │    └──────────────────────────────┘
│  │   _state/namespaces.json     │
│  │   _backups/  (snapshots)     │      Backup CronJob (daily):
│  └──────────────────────────────┘        - GET /v1/namespaces
│                ▲                         - For each, GET .../backup
│                │ admin REST              - `curl | mc pipe` → S3
│                │                         - Retention (default 14d)
│                │                         - Prune old in S3
│  ┌─────────────┴──────────────┐
│  │ CronJob:                   │
│  │ <release>-turso-backup     │───────▶ ┌────────────────────────┐
│  │  image: turso-backup       │         │ MinIO (S3-compatible)  │
│  │  (sh + curl + jq + mc)     │         │ bucket: turso-backups  │
│  └────────────────────────────┘         └────────────────────────┘
└─────────────────────────────────────────────────────────────────────┘
```

Key points:

- **PVCs per pod** for `/data/state` (RWO via `volumeClaimTemplates`).
  Universal across storage classes — works with k3s `local-path`,
  Longhorn, EBS, etc.
- **Shared PVCs** (RWX) only for filesystems that need cross-pod
  visibility: `/data/plugins`, `/data/apps`. On single-node clusters
  RWO suffices because pods schedule on the same node.
- **Two services**: `<release>-turso` (data, port 8080) for every pod;
  `<release>-turso-admin` (admin, port 8081) for the control plane
  only. Pair the admin Service with a `NetworkPolicy` in shared
  clusters.
- **Backup CronJob** uses the hot-backup admin endpoint (`VACUUM INTO`
  on the live tursodb) — no downtime, no file locks, consistent
  snapshots. Replaces Litestream, which is incompatible with
  `tursodb --sync-server` (see
  [`turso-server.md` — Why Litestream does NOT work](./turso-server.md#why-litestream-does-not-work-here)).

## Pre-requisites

1. Kubernetes cluster with a default `StorageClass` (Rancher local:
   `local-path`).
2. Optional but recommended: **MinIO** (or any S3-compatible storage)
   reachable from the cluster, with a bucket ready
   (`turso-backups` by default). The chart does **not** provision MinIO.
3. Helm 3.x.

## Setup

### 1. Install with the in-cluster turso-server + backup CronJob

```sh
helm install buntime ./charts \
  --set replicaCount=3 \
  --set buntime.rootKey=$ROOT_KEY \
  --set buntime.authDb.mode=sync \
  --set tursoServer.enabled=true \
  --set tursoServer.authToken=$TURSO_DATA_TOKEN \
  --set tursoServer.adminToken=$TURSO_ADMIN_TOKEN \
  --set tursoServer.persistence.size=10Gi \
  --set tursoServer.backup.enabled=true \
  --set tursoServer.backup.s3.endpoint=http://minio.minio.svc.cluster.local:9000 \
  --set tursoServer.backup.s3.bucket=turso-backups \
  --set tursoServer.backup.s3.accessKeyId=$MINIO_KEY \
  --set tursoServer.backup.s3.secretAccessKey=$MINIO_SECRET
```

What this does:

- Provisions `buntime-turso-0` (1 replica) running our supervisor.
- Provisions `buntime-0`, `buntime-1`, `buntime-2` (3 replicas) — each
  with its own `/data/state` PVC.
- `ApiKeyStore` in each pod opens an embedded replica of the
  `api-keys` namespace and syncs through the turso-server data port.
- `plugin-turso` in each pod opens **multi-tenant** replicas — one per
  namespace requested by `connect(name)`. Default namespaces are
  `runtime` and one per loaded plugin (`keyval`, `gateway`, `proxy`).
- The `<release>-turso-backup` CronJob runs daily at 02:00 UTC,
  uploading hot snapshots of every active namespace to MinIO.

### 2. Adding new databases

Namespaces are created **on first connect** — no admin step needed.
When a plugin or app calls `turso.connect("my-app-db")`,
`turso-server` spawns a `tursodb` subprocess for that namespace, the
database file appears under `/var/lib/turso/my-app-db.db`, and the
next backup CronJob run picks it up automatically. No `helm upgrade`
required to start backing up new databases — the CronJob enumerates
namespaces via the admin API at every run.

For control over lifecycle (e.g., when installing an app via the
control plane), call the admin API explicitly:

```sh
curl -X POST -H "Authorization: Bearer $TURSO_ADMIN_TOKEN" \
  http://<release>-turso-admin:8081/v1/namespaces/my-app-db/create
```

Explicit creates are marked `locked=true` and the GC will not archive
them on idle. Auto-created namespaces are unlocked and subject to
`tursoServer.autoIdleDuration` (default 7 d).

### 3. Disaster recovery

When the `turso-server` pod restarts with its PVC intact, no action is
required — the supervisor reads `_state/namespaces.json` and respawns
one `tursodb` per namespace.

When the **PVC is lost** (node failure, manual delete), the snapshot
CronJob output in S3 is the recovery source. Two paths:

**Offline (recommended for incident postmortems)** — read the snapshot
file in a one-off pod:

```sh
mc cp m/turso-backups/api-keys/api-keys-<ts>.db ./api-keys.db
docker run --rm -v $(pwd):/work registry.example.com/zomme/turso:0.6.0 \
  /work/api-keys.db "SELECT * FROM api_keys"
```

**Live (cluster restore)** — copy the latest snapshot for each
namespace into `/var/lib/turso/<name>.db` on a fresh PVC, then
`chown 9000:9000` (uid of the `turso` user inside the image), then
start the turso-server pod. See
[`turso-server.md` — Restoring](./turso-server.md#restoring) for the
exact procedure and the known limitation about CDC log not being part
of `VACUUM INTO` output — replica clients connecting **after** the
restore need a sync-state reset to see the recovered rows. This is
tracked as a follow-up; for now the offline path is the supported
recovery model.

## Day-zero flow (without the server)

Single-pod deploys can run **without** the server. Default:

```sh
helm install buntime ./charts --set buntime.rootKey=$ROOT_KEY
```

- `replicaCount: 1`, `authDb.mode: local`.
- `ApiKeyStore` opens a standalone Turso DB at
  `/data/state/api-keys.db`.
- `plugin-turso` runs `mode: local` against its own per-pod file.
- Operator pastes `RUNTIME_ROOT_KEY` in the cpanel and bootstraps from
  there.

To upgrade later: `helm upgrade` with `tursoServer.enabled=true` and
`authDb.mode=sync`. The local `api-keys.db` cannot be moved cleanly
into the new sync namespace — re-create the keys via the cpanel after
upgrade.

## Cloud Turso (managed) — note only

If you want to skip running the server in-cluster, point
`buntime.authDb.syncUrl` (and the equivalents for plugin-turso) at a
Turso Cloud database URL and set `tursoServer.enabled=false`. This is
**not** the recommended path for this project (premise: fully
self-hosted) but the runtime supports it because the protocol is
identical.

## Cross-refs

- [turso-server](./turso-server.md) — wrapper internals, REST,
  backup/restore details.
- [Storage overview](../data/storage-overview.md) — control vs data
  plane databases.
- [Helm charts](./helm-charts.md) — values reference.
- [plugin-turso](../apps/plugin-turso.md) — multi-tenant mode.
- [Runtime API reference](../apps/runtime-api-reference.md) —
  `RUNTIME_AUTH_DB_*` env vars.
