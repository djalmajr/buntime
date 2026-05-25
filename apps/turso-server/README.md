# @buntime/turso-server

Multi-tenant wrapper around the official `tursodb --sync-server` binary
(<https://github.com/tursodatabase/turso>) that emulates the namespace
lifecycle semantics of `sqld` (libsql-server) while keeping the toolchain
on Turso DB.

See [`wiki/ops/turso-server.md`](../../wiki/ops/turso-server.md) for the
canonical documentation. This README only links contributors to the wiki
per the repo's policy on documentation location.

## TL;DR

- One Go binary supervises N `tursodb` subprocesses, one per namespace.
- Data port (`:8080`): namespace-aware HTTP reverse proxy. Clients use
  `libsql://server:8080/<namespace>` and the wrapper strips the prefix
  before forwarding to the matching tursodb process.
- Admin port (`:8081`): REST API to create/delete/list namespaces and
  toggle lock/ttl.
- Namespaces auto-create on first data request (configurable). Idle and
  TTL-expired namespaces are archived by a background GC.

## Build

```sh
cd apps/turso-server
go build ./...
```

## Run

```sh
TURSO_AUTH_TOKEN=...  TURSO_ADMIN_TOKEN=... \
  TURSODB_BIN=/usr/local/bin/tursodb \
  TURSO_DATA_DIR=/var/lib/turso \
  ./turso-server
```
