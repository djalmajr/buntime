---
title: Roadmap
description: Capabilities that are planned or in progress but not yet implemented in the runtime.
sidebar:
  order: 99
---

This page tracks work that is **designed or partially built but not yet shipped**.
Everything documented elsewhere on this site reflects what's implemented today;
this is the explicit exception.

:::caution[Not implemented]
Nothing on this page is available in the current runtime. Treat it as direction,
not documentation.
:::

## Planned plugins

These plugins appear in design notes and the broader plugin catalog but are
**not present in the repository** today. They're documented here so the gap is
explicit rather than implied.

| Plugin | Intent |
|--------|--------|
| `plugin-database` | A multi-adapter database service. The target direction is to consolidate durable SQL on [`plugin-turso`](/plugins/turso/) rather than evolve a separate adapter layer. |
| `plugin-authn` | Authentication — OIDC/Keycloak/JWT, email-password, identity model, SCIM. |
| `plugin-authz` | Authorization — XACML-style PEP/PDP/PAP with policies and combining algorithms. |
| `plugin-deployments` | A serverless plugin for managing worker deployments. |

## Routing & multi-tenancy

- **Subdomain / vhost routing** — mapping `app.example.host` → `@ns/app` through
  [`plugin-vhosts`](/plugins/vhosts/), reusing the existing worker resolver. The
  hostname-based plumbing exists; the host→app mapping is the remaining piece.
- **Per-environment plugin activation** — enabling a plugin only under a given
  namespace (e.g. `@production`). Today `manifest.enabled` is global
  (all-or-nothing).

## Security backlog

A historical security and availability audit is tracked separately (plugin
scan/load timeouts, worker-pool behavior under high load, and related
hardening). These are improvements to existing subsystems rather than new
features. See [Security](/ops/security/) for what's enforced today.

## Related

- [Plugins overview](/plugins/) — what's actually bundled and runnable now.
- [Philosophy](/start/philosophy/) — the principles guiding what does and doesn't get built.
