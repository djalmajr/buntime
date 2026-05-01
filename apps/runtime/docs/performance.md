# Runtime Performance

This runtime includes a local performance harness for serverless worker scenarios. The harness uses temporary worker apps and the real runtime routing/pool path, so it is useful as a repeatable baseline before using external load tools in staging.

## Command

```bash
cd apps/runtime
bun run perf
```

The default mode starts an in-process `Bun.serve` instance on a random local port and drives requests through `fetch`. This includes HTTP parsing, Hono routing, worker resolution, body cloning, worker pool dispatch, and response body transfer.

CI-oriented commands:

```bash
bun run perf:smoke   # short direct-mode run without thresholds
bun run perf:ci      # short direct-mode run with perf/thresholds.json and perf-results.json
bun run perf:gate    # default full run with perf/thresholds.json
```

## Scenarios

| Scenario | Purpose |
| --- | --- |
| `warm-noop` | Warm persistent worker latency and throughput. |
| `echo-1kb` | POST body handling, request cloning, worker transfer, and response serialization. |
| `slow-50ms` | Concurrency behavior while workers spend time processing. |
| `ephemeral-noop` | Cold worker creation path with `ttl: 0`; intentionally lower default concurrency. |

## Environment

| Variable | Default | Description |
| --- | --- | --- |
| `PERF_MODE` | `http` | Use `http` for `Bun.serve` or `direct` for `app.fetch` without socket overhead. |
| `PERF_DURATION_MS` | `10000` | Measured duration per scenario. |
| `PERF_WARMUP_MS` | `2000` | Warmup duration per scenario. |
| `PERF_CONCURRENCY` | `50` | Default concurrent request loops. |
| `PERF_POOL_SIZE` | `100` | Worker pool size for the run. |
| `PERF_CLIENT_TIMEOUT_MS` | `10000` | Client-side timeout per request. |
| `PERF_PORT` | random high port | Fixed localhost port for `PERF_MODE=http`. |
| `PERF_SCENARIOS` | all | Comma-separated scenario names, for example `warm-noop,echo-1kb`. |
| `PERF_JSON` | unset | Set to `1` to print machine-readable JSON after the table. |
| `PERF_OUTPUT_FILE` | unset | Writes the full JSON report to a file. |
| `PERF_GATE_FILE` | unset | Reads scenario thresholds from a JSON file and fails the command when any threshold is violated. |
| `PERF_KEEP_FIXTURES` | unset | Set to `1` to keep generated apps under `.perf-fixtures`. |

Runtime tuning variables that affect these runs:

| Variable | Default | Description |
| --- | --- | --- |
| `RUNTIME_EPHEMERAL_CONCURRENCY` | `2` | Max concurrent `ttl: 0` worker requests. Excess requests wait instead of spawning more workers. |
| `RUNTIME_WORKER_CONFIG_CACHE_TTL_MS` | `1000` | Positive worker config cache TTL. Set to `0` to disable. |
| `RUNTIME_WORKER_RESOLVER_CACHE_TTL_MS` | `1000` | Positive worker directory resolver cache TTL. Set to `0` to disable. |

Examples:

```bash
PERF_DURATION_MS=30000 PERF_CONCURRENCY=200 PERF_POOL_SIZE=500 bun run perf
PERF_MODE=direct PERF_SCENARIOS=warm-noop PERF_DURATION_MS=15000 bun run perf
PERF_SCENARIOS=ephemeral-noop PERF_CONCURRENCY=5 bun run perf
PERF_GATE_FILE=perf/thresholds.json PERF_OUTPUT_FILE=perf-results.json bun run perf
```

## Gates

`perf/thresholds.json` is intentionally conservative so it works as a local CI smoke gate on small runners. It checks:

- `maxErrors`: maximum failed requests. Defaults to `0` even without a gate file.
- `minRps`: minimum requests per second.
- `maxP95Ms` and `maxP99Ms`: latency percentile ceilings.
- `maxAvgMs`: optional average latency ceiling.

Treat these thresholds as a regression guard, not as a capacity target. Tighten them after collecting repeated samples from the same runner or from the Rancher/k3s environment.

## Reading Results

The table reports request count, requests per second, errors, and latency percentiles (`p50`, `p95`, `p99`) in milliseconds. The script also prints pool metrics such as active workers, hit rate, worker creations, worker failures, and heap usage.

The command exits with code `1` when any scenario records errors or violates a configured gate. This is intentional: a benchmark run with timeouts, non-2xx/3xx responses, or latency/throughput regressions should fail CI. The `ephemeral-noop` scenario is a cold-start churn test and is expected to be more sensitive to CPU pressure because it creates a worker per request.

Use the run as a baseline trend, not as an absolute production capacity number. For production readiness, run the same scenarios against the packaged runtime in an environment that matches CPU, memory limits, proxy behavior, and Kubernetes settings.

## Current Next Checks

- Keep `bun test` and `bun run lint:types` green before comparing performance runs.
- Compare `http` and `direct` modes to separate runtime overhead from socket/client overhead.
- Track `warm-noop` p95/p99 and pool hit rate after changes to routing, config loading, worker resolution, or plugin hooks.
- Track `ephemeral-noop` separately because it measures cold worker churn, not steady-state throughput.
