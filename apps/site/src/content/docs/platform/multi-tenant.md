---
title: Multi-tenant platform
description: A reference multi-tenant SaaS built on one Buntime runtime — shell, platform, and todos.
sidebar:
  order: 1
---

A reference implementation of a multi-tenant SaaS on a single Buntime instance:
**one runtime serves many hosts**, each host maps to its own tenant context.
It's a worked example of how the runtime, gateway app-shell, and per-tenant
infrastructure fit together — not a built-in feature of the runtime itself.

It is composed of three apps plus the gateway plugin:

| App | Role |
|-----|------|
| [`apps/shell`](https://github.com/zommehq/buntime/tree/main/apps/shell) | Per-host frontend — resolves the tenant from the hostname, authenticates against that host's Keycloak realm, and renders the app catalog with `@zomme/frame`. |
| [`apps/platform`](https://github.com/zommehq/buntime/tree/main/apps/platform) | The tenant control plane — a Hono API + React UI holding the tenant registry, the provisioner, and per-tenant config/catalog. |
| [`apps/todos`](https://github.com/zommehq/buntime/tree/main/apps/todos) | A small example app served through the shell. |

## How a tenant is served

```
Request to tenant.example.dev
  → shell resolves the tenant from the Host header
  → authenticates against that tenant's Keycloak realm
  → loads the tenant's app catalog
  → renders each app as a <z-frame> iframe
```

The runtime stays generic: it routes by path and host, runs workers, and serves
the shell. All tenant-awareness lives in the platform apps and per-tenant
infrastructure.

## Provisioning a tenant

When a new tenant is created, the provisioner (`apps/platform/server`)
orchestrates the per-tenant infrastructure:

1. **Identity** — a dedicated Keycloak realm per host, with an admin service
   account for tenant API access and JWT validation.
2. **Database** — a per-tenant [Turso](/plugins/turso/) instance (embedded
   SQLite replica, optionally synced to a Turso server for multi-pod setups).
3. **Ingress** — a Kubernetes `Ingress` for `tenant.example.dev` pointing at the
   runtime (the "Phase 2" automation, created via the Kubernetes API).
4. **DNS** — records for the tenant subdomain.

## Tenant isolation

- **Routing** — requests to `*.example.dev` are multiplexed by hostname in the
  shell.
- **Identity** — one Keycloak realm per tenant; tokens are scoped to that realm.
- **API namespaces** — generated API keys can be scoped to a `@namespace`, so a
  key for `@acme` cannot reach `@other`'s workers. See [Security](/ops/security/).
- **Database** — each tenant's Turso instance is separate.

:::note
This page is an overview of the reference platform. The runtime concepts it
builds on are documented under [Core Concepts](/concepts/runtime/); operational
details (multi-pod, Turso server, Helm) live under [Operations](/ops/environment/).
:::

## Related

- [CPanel](/platform/cpanel/) — the operator UI for managing workers, plugins, and keys.
- [`plugin-gateway`](/plugins/gateway/) — provides the app-shell the platform renders into.
- [`plugin-turso`](/plugins/turso/) — the per-tenant durable database.
- [turso-server](/ops/turso-server/) — the multi-tenant Turso supervisor for multi-pod deploys.
