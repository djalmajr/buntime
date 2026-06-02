---
title: Philosophy
description: The design principles behind Buntime — why the runtime is built the way it is.
sidebar:
  order: 2
---

Buntime makes a handful of opinionated bets. Understanding them explains almost
every API decision in the runtime.

## 1. The main thread orchestrates; it never executes app code

The process that calls `Bun.serve` resolves routes, runs plugin hooks, and
dispatches work — but application code runs **only** inside workers. A worker
that throws, hangs, or leaks memory is retired and replaced; the runtime keeps
serving. This is the single most important invariant in the system.

## 2. Workers enforce real isolation

Each worker is a separate Bun thread with its own heap, its own module cache,
and its own scoped `Bun.env` injected at spawn time. Two apps can depend on
different versions of the same package without conflict, and no app can read
another's globals. Sensitive environment variables (keys, tokens, passwords,
database URLs) are **filtered out** before they ever reach a worker.

## 3. Plugins intercept without coupling to each other

Cross-cutting concerns — auth, CORS, rate limiting, metrics, proxying — are
plugins. They hook into the request/response pipeline (`onRequest`,
`onResponse`) and can register routes or share services, but they never import
one another directly. Dependencies are **declared** in a manifest and resolved
by the loader, so a plugin can be added, disabled, or reordered without editing
the others.

## 4. Base-path injection makes SPAs portable

A single-page app shouldn't need to know the URL prefix it's mounted under. The
runtime injects `<base href>` (and an `X-Base` header) so a SPA built for `/`
works unchanged at `/dashboard/`, `/@acme/console/`, or anywhere else — no
bundler reconfiguration.

## 5. Topological sort orders plugins by dependency

Before any `onInit` runs, plugins are sorted with Kahn's algorithm. A plugin
that depends on `@buntime/plugin-database` is guaranteed to initialize after
it, regardless of filesystem order. Dependency cycles are a hard error caught
at startup, not a mysterious runtime failure.

## 6. Resilience is the default, not an add-on

The loader is built to degrade gracefully:

- A plugin that fails to load is skipped; its dependents are skipped too; the
  rest of the system loads normally.
- `onInit` has a **30-second timeout** — a hanging plugin can't wedge boot.
- Shutdown runs hooks in reverse (LIFO) under a global 30-second budget, then
  forces exit so a stuck cleanup can't block forever.

## What Buntime is *not*

- **Not a framework for your app.** Your app is just a module that exports a
  `fetch` handler (or a routes object, or an `index.html`). Buntime runs it; it
  doesn't dictate how you write it.
- **Not a place for business rules.** The runtime is generic infrastructure.
  Domain logic belongs to the products that run on it.
- **Not a hard sandbox.** Worker isolation is about stability and hygiene
  (separate heaps, filtered env), not adversarial multi-tenant security
  boundaries on its own. Tenant isolation is layered on top — see
  [the platform](/platform/multi-tenant/) and [security](/ops/security/).

:::tip[Reading order]
These principles map directly onto the deep-dive pages: orchestration and
routing live in [Runtime](/concepts/runtime/), isolation and TTL in
[Worker Pool](/concepts/worker-pool/), and hooks/dependencies in
[Plugin System](/concepts/plugin-system/).
:::
