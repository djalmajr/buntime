---
title: "Performance and Tuning"
audience: ops
sources:
  - apps/runtime/docs/performance.md
  - wiki/sources/2026-05-01-performance-rancher-pod-load.md
  - wiki/sources/2026-05-01-performance-rancher-worker-routes.md
  - apps/runtime/docs/deployment/configuration.md
  - apps/runtime/docs/concepts/worker-pool.md
updated: 2026-05-02
tags: [performance, perf, k6, benchmark]
status: stable
---

# Performance and Tuning

> How to measure, gate, and tune Buntime performance. The local harness (`bun run perf` in `apps/runtime/`) covers the worker pool + routing; Rancher/k3s environments are in dated reports (referenced at the bottom). For the pool model itself, see [worker-pool](../apps/worker-pool.md).

## Local harness

Runs inside `apps/runtime` itself. Uses temporary apps generated in `.perf-fixtures/` and the real routing/pool path — useful as a baseline before external tests.

```bash
cd apps/runtime
bun run perf            # full run (all scenarios, default gates)
bun run perf:smoke      # short direct-mode, no thresholds
bun run perf:ci         # short direct-mode with perf/thresholds.json
bun run perf:gate       # full run with perf/thresholds.json
```

`PERF_MODE=http` (default) starts `Bun.serve` on a local port and drives requests via `fetch` — includes HTTP parsing, Hono routing, pool dispatch, body cloning, and response transfer. `PERF_MODE=direct` calls `app.fetch` in memory, isolating socket/client overhead.

## Scenarios

| Scenario | Measures | Good for detecting |
|----------|----------|--------------------|
| `warm-noop` | Latency/throughput of an already-warm persistent worker | Regression in routing, pool hit, plugin hooks |
| `echo-1kb` | 1 KiB POST body: clone, transfer to worker, response | Serialization/IPC costs in the pool |
| `slow-50ms` | Concurrency while worker processes 50 ms | Backpressure, pool fairness |
| `ephemeral-noop` | Cold start with `ttl: 0` (new worker per request) | Spawn cost; **most sensitive to CPU** |

> `ephemeral-noop` runs with lower concurrency by default. Do not treat it as steady-state — it is a churn test.

## Harness variables

| Var | Default | Description |
|-----|---------|-------------|
| `PERF_MODE` | `http` | `http` (Bun.serve) or `direct` (`app.fetch`) |
| `PERF_DURATION_MS` | `10000` | Measured duration per scenario |
| `PERF_WARMUP_MS` | `2000` | Warmup per scenario |
| `PERF_CONCURRENCY` | `50` | Concurrent loops |
| `PERF_POOL_SIZE` | `100` | LRU pool size |
| `PERF_CLIENT_TIMEOUT_MS` | `10000` | Client timeout |
| `PERF_PORT` | random | Fixed port in `PERF_MODE=http` |
| `PERF_SCENARIOS` | all | CSV: `warm-noop,echo-1kb` |
| `PERF_JSON` | unset | `1` for machine-readable JSON |
| `PERF_OUTPUT_FILE` | unset | JSON report output path |
| `PERF_GATE_FILE` | unset | JSON with thresholds (`maxErrors`, `minRps`, `maxP95Ms`, `maxP99Ms`, `maxAvgMs`) |
| `PERF_KEEP_FIXTURES` | unset | `1` keeps generated apps in `.perf-fixtures/` |

Examples:

```bash
PERF_DURATION_MS=30000 PERF_CONCURRENCY=200 PERF_POOL_SIZE=500 bun run perf
PERF_MODE=direct PERF_SCENARIOS=warm-noop PERF_DURATION_MS=15000 bun run perf
PERF_SCENARIOS=ephemeral-noop PERF_CONCURRENCY=5 bun run perf
PERF_GATE_FILE=perf/thresholds.json PERF_OUTPUT_FILE=perf-results.json bun run perf
```

## Runtime tuning vars

These directly affect the numbers the harness measures and production behavior.

| Var | Default | Effect |
|-----|---------|--------|
| `RUNTIME_EPHEMERAL_CONCURRENCY` | `2` | Maximum parallel `ttl: 0` requests. Excess goes into the queue |
| `RUNTIME_EPHEMERAL_QUEUE_LIMIT` | `100` | Queue depth before returning `503` |
| `RUNTIME_WORKER_CONFIG_CACHE_TTL_MS` | `1000` | Cache TTL for worker manifest/config. `0` disables |
| `RUNTIME_WORKER_RESOLVER_CACHE_TTL_MS` | `1000` | Cache TTL for app directory lookup. `0` disables |

Recommendations:

- **`ttl: 0` apps** (functions/serverless): keep boot cheap. Increase `RUNTIME_EPHEMERAL_CONCURRENCY` only with spare CPU — each request pays a full spawn.
- **`ttl > 0` apps** (HTTP services): TTL is **sliding** — each request renews it. The LRU pool evicts the oldest on fill.
- **Cache TTL = 0** only in dev when app files change constantly; in production, `1000 ms` is safe.
- See also [storage-overview](../data/storage-overview.md#worker-pool-in-memory-caches) about the caches.

## Gates

`perf/thresholds.json` is intentionally conservative — it works as a smoke gate on a small runner. It checks:

- `maxErrors` (default `0` even without a gate file)
- `minRps`
- `maxP95Ms`, `maxP99Ms`
- `maxAvgMs` (optional)

Tighten gradually after collecting repeated samples on the same runner or Rancher/k3s environment. Do not aim for "production capacity" in the local harness — it measures regression, not capacity.

## Reading the results

The report table shows:

| Metric | Notes |
|--------|-------|
| Requests, RPS | Throughput per scenario |
| Errors | Timeouts, non-2xx/3xx — treated as gate failures |
| `p50`, `p95`, `p99` (ms) | Latency. P99 tends to regress first |
| Pool active workers | Should converge to `PERF_POOL_SIZE` in warm scenarios |
| Pool hit rate | Expected >90% in `warm-noop`; ~0% in `ephemeral-noop` |
| Worker creations / failures | Spike in `ephemeral-noop`; should be stable in warm |
| Heap usage | For detecting leaks between runs |

Exit code `1` on any error or gate violation — intentionally "fail loud" in CI.

## Rancher/k3s environments

Dated reports (do not copy content — these are snapshots, read as supplementary material):

| Report | Focus |
|--------|-------|
| [`2026-05-01-performance-rancher-pod-load.md`](../sources/2026-05-01-performance-rancher-pod-load.md) | k6 against `GET /_/api/health` on the pod (Ingress + TLS + Traefik); pod impact (CPU/mem) |
| [`2026-05-01-performance-rancher-worker-routes.md`](../sources/2026-05-01-performance-rancher-worker-routes.md) | k6 against temporary worker routes (`perf-noop`, `perf-echo`, `perf-slow`, `perf-ephemeral`) installed on Rancher |

Both run against `https://buntime.home`, namespace `zomme`, with lab TLS (`--insecure-skip-tls-verify`). The second covers warm + 1 KiB POST + slow 50 ms + cold churn (`ttl: 0`) with the gateway rate limit (`100 req/min`) active.

> The local harness does not cover Ingress, TLS, Traefik, or K8s scheduling — differences between it and the Rancher reports reflect those layers, not the runtime itself.

## Checklist before comparing runs

- `bun test` and `bun run lint:types` passing on both sides.
- Comparing `http` and `direct` separates runtime overhead from socket/client overhead.
- Watch `warm-noop` p95/p99 + pool hit rate after any change to routing, config loading, worker resolution, or plugin hooks.
- Track `ephemeral-noop` separately — it is cold-start churn, not steady-state.
- Use the same runner (laptop, CI runner, Rancher pod) between runs: comparing runs across different machines is not apples-to-apples.

## What to measure after each change

Mapping of "change type → sensitive scenario":

| Changed… | Run… | Check first |
|----------|------|-------------|
| Routing / Hono middleware | `warm-noop` | p95/p99, RPS, pool hit rate |
| Plugin `onRequest` hook | `warm-noop` | p95/p99 (additive overhead per hook) |
| Worker pool LRU / lifecycle | `warm-noop` + `ephemeral-noop` | Worker creations, pool size, hit rate |
| IPC / wrapper.ts (worker) | `echo-1kb` | p95/p99 and throughput on large request body |
| Config loading / app.yaml parsing | `ephemeral-noop` | Cold-start RPS |
| Worker resolver (app lookup) | `ephemeral-noop` | Cold-start RPS, failures |

## Known harness limitations

- `.perf-fixtures/` is deleted by default between runs; use `PERF_KEEP_FIXTURES=1` to inspect generated manifests.
- The harness does not exercise Ingress, TLS, Traefik, NetworkPolicy, or K8s scheduling — for that, run k6 on Rancher (links above).
- On laptops with thermal throttling, long runs (`PERF_DURATION_MS > 60000`) tend to degrade — use short runs for regression and long runs for capacity.
- `PERF_MODE=direct` deliberately ignores HTTP server overhead. Do not use it alone as a baseline — always compare with `http`.

## Cross-references

- [worker-pool](../apps/worker-pool.md) — LRU model, sliding TTL, ephemeral queue.
- [storage-overview](../data/storage-overview.md) — tunable in-memory caches, file stores.
- `apps/runtime/docs/deployment/configuration.md` — all runtime env vars in one place.
