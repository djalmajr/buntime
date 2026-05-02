---
title: "Rancher Worker Route Load Test - 2026-05-01"
audience: ops
sources:
  - apps/runtime/docs/performance-rancher-worker-routes-2026-05-01.md (moved 2026-05-02)
updated: 2026-05-01
tags: [source, performance, k6, rancher, worker, report]
status: stable
---

# Rancher Worker Route Load Test - 2026-05-01

This report documents the external worker/app route load test executed against
the Buntime pod running in the local Rancher/k3s environment.

## Environment

| Item | Value |
| --- | --- |
| Runtime URL | `https://buntime.home` |
| Namespace | `zomme` |
| Deployment | `buntime` |
| Pod | `buntime-76dcb486b7-w99z8` |
| Replicas | `1` |
| Image | `ghcr.io/zommehq/buntime:runtime-performance-resilience` |
| CPU request / limit | `250m` / `2` |
| Memory request / limit | `256Mi` / `1Gi` |
| Gateway rate limit | `100` requests / `1m` from `GATEWAY_RATE_LIMIT_REQUESTS` and `GATEWAY_RATE_LIMIT_WINDOW` |
| Tool | `k6` |
| TLS | `--insecure-skip-tls-verify` because the lab uses local/self-signed TLS |

## Temporary Test Apps

Four temporary apps were installed through the CLI/API into `/data/apps`:

| App | Route | Purpose | TTL |
| --- | --- | --- | --- |
| `perf-noop` | `GET /perf-noop/ping` | Warm persistent worker throughput/latency | `5m` |
| `perf-echo` | `POST /perf-echo/body` | 1 KiB request body clone/transfer/response | `5m` |
| `perf-slow` | `GET /perf-slow/wait?ms=50` | Concurrency while worker waits 50 ms | `5m` |
| `perf-ephemeral` | `GET /perf-ephemeral/ping` | Cold worker churn with `ttl: 0` | `0` |

Install command pattern:

```bash
cd apps/cli

go run . \
  --url https://buntime.home \
  --token "$RUNTIME_MASTER_KEY" \
  --insecure \
  app install /private/tmp/buntime-rancher-worker-apps/perf-noop.zip
```

The CLI discovers the API base from `/.well-known/buntime`, so this correctly
targets the configured `/_/api` deployment.

Cleanup command pattern after the test apps are no longer needed:

```bash
cd apps/cli

for app in perf-noop perf-echo perf-slow perf-ephemeral; do
  go run . \
    --url https://buntime.home \
    --token "$RUNTIME_MASTER_KEY" \
    --insecure \
    app remove "$app"
done
```

## k6 Script

The test ran four sequential constant-arrival-rate scenarios:

```js
import http from "k6/http";
import { check } from "k6";

const baseUrl = __ENV.RUNTIME_URL || "https://buntime.home";
const oneKb = "x".repeat(1024);
const apiKey = __ENV.RUNTIME_API_KEY || "";

function authHeaders(extra = {}) {
  return apiKey ? { ...extra, "X-API-Key": apiKey } : extra;
}

export const options = {
  discardResponseBodies: true,
  scenarios: {
    warm_noop: {
      executor: "constant-arrival-rate",
      exec: "warmNoop",
      duration: "30s",
      rate: 300,
      timeUnit: "1s",
      preAllocatedVUs: 60,
      maxVUs: 200,
    },
    echo_1kb: {
      executor: "constant-arrival-rate",
      exec: "echo1kb",
      startTime: "35s",
      duration: "30s",
      rate: 200,
      timeUnit: "1s",
      preAllocatedVUs: 60,
      maxVUs: 200,
    },
    slow_50ms: {
      executor: "constant-arrival-rate",
      exec: "slow50ms",
      startTime: "70s",
      duration: "30s",
      rate: 50,
      timeUnit: "1s",
      preAllocatedVUs: 30,
      maxVUs: 120,
    },
    ephemeral_noop: {
      executor: "constant-arrival-rate",
      exec: "ephemeralNoop",
      startTime: "105s",
      duration: "30s",
      rate: 20,
      timeUnit: "1s",
      preAllocatedVUs: 40,
      maxVUs: 160,
    },
  },
  thresholds: {
    "http_req_failed{endpoint:warm-noop}": ["rate<0.01"],
    "http_req_duration{endpoint:warm-noop}": ["p(95)<250", "p(99)<500"],
    "http_req_failed{endpoint:echo-1kb}": ["rate<0.01"],
    "http_req_duration{endpoint:echo-1kb}": ["p(95)<300", "p(99)<750"],
    "http_req_failed{endpoint:slow-50ms}": ["rate<0.01"],
    "http_req_duration{endpoint:slow-50ms}": ["p(95)<300", "p(99)<750"],
    "http_req_failed{endpoint:ephemeral-noop}": ["rate<0.01"],
    "http_req_duration{endpoint:ephemeral-noop}": ["p(95)<1000", "p(99)<1500"],
  },
};

function verify(response, endpoint) {
  check(response, { "status is 200": (res) => res.status === 200 }, { endpoint });
}

export function warmNoop() {
  const endpoint = "warm-noop";
  verify(http.get(`${baseUrl}/perf-noop/ping`, { headers: authHeaders(), tags: { endpoint } }), endpoint);
}

export function echo1kb() {
  const endpoint = "echo-1kb";
  verify(
    http.post(`${baseUrl}/perf-echo/body`, oneKb, {
      headers: authHeaders({ "content-type": "text/plain" }),
      tags: { endpoint },
    }),
    endpoint,
  );
}

export function slow50ms() {
  const endpoint = "slow-50ms";
  verify(http.get(`${baseUrl}/perf-slow/wait?ms=50`, { headers: authHeaders(), tags: { endpoint } }), endpoint);
}

export function ephemeralNoop() {
  const endpoint = "ephemeral-noop";
  verify(http.get(`${baseUrl}/perf-ephemeral/ping`, { headers: authHeaders(), tags: { endpoint } }), endpoint);
}
```

## Commands

Smoke checks:

```bash
curl -sk -o /dev/null -w 'noop status=%{http_code} total=%{time_total}s\n' \
  https://buntime.home/perf-noop/ping

curl -sk -o - -w '\necho status=%{http_code} total=%{time_total}s\n' \
  -H 'content-type: text/plain' \
  --data-binary '0123456789' \
  https://buntime.home/perf-echo/body

curl -sk -o /dev/null -w 'slow status=%{http_code} total=%{time_total}s\n' \
  'https://buntime.home/perf-slow/wait?ms=50'

curl -sk -o /dev/null -w 'ephemeral status=%{http_code} total=%{time_total}s\n' \
  https://buntime.home/perf-ephemeral/ping
```

Unauthenticated run, intentionally left behind the gateway rate limiter:

```bash
RUNTIME_URL=https://buntime.home \
  k6 run --insecure-skip-tls-verify \
  --summary-export /private/tmp/buntime-worker-routes-k6-summary.json \
  /private/tmp/buntime-worker-routes-k6.js
```

Authenticated run, used to isolate runtime worker performance from the gateway
rate limiter:

```bash
RUNTIME_URL=https://buntime.home \
RUNTIME_API_KEY="$RUNTIME_MASTER_KEY" \
  k6 run --insecure-skip-tls-verify \
  --summary-export /private/tmp/buntime-worker-routes-auth-k6-summary.json \
  /private/tmp/buntime-worker-routes-k6.js
```

Pod monitoring:

```bash
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28; do
  printf '%s ' "$(date +%H:%M:%S)"
  kubectl top pod -n zomme -l app.kubernetes.io/name=buntime --containers --no-headers
  sleep 5
done
```

Post-run checks:

```bash
kubectl exec -n zomme buntime-76dcb486b7-w99z8 -- sh -c \
  'printf "memory.current="; cat /sys/fs/cgroup/memory.current; egrep "^(VmSize|VmRSS|RssAnon|RssFile|Threads):" /proc/1/status'

kubectl get pod buntime-76dcb486b7-w99z8 -n zomme \
  -o jsonpath='{.status.containerStatuses[0].restartCount}{"\n"}{.status.containerStatuses[0].lastState}{"\n"}'
```

## Results

### Gateway-Limited Run

The unauthenticated run hit plugin-gateway rate limiting and returned many
`429 Too Many Requests` responses. This is expected with the current lab config:

```text
GATEWAY_RATE_LIMIT_REQUESTS=100
GATEWAY_RATE_LIMIT_WINDOW=1m
```

Observed 429 rates:

| Endpoint | 429 rate |
| --- | ---: |
| `warm-noop` | `83.34%` |
| `echo-1kb` | `90.26%` |
| `slow-50ms` | `61.15%` |
| `ephemeral-noop` | `2.99%` |

This run proves the public app path is protected by the gateway limiter. It is
not a valid worker capacity measurement.

### Authenticated Worker Run

The authenticated run sent `X-API-Key`, which makes the runtime bypass plugin
`onRequest` hooks and isolates the worker/app execution path. It passed all k6
thresholds with zero HTTP failures.

| Scenario | Target | Requests | Failures | Median | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `warm-noop` | `300/s` for `30s` | `9,001` | `0` | `1.25ms` | `2.59ms` | `9.51ms` | `44.16ms` |
| `echo-1kb` | `200/s` for `30s` | `6,001` | `0` | `1.53ms` | `2.88ms` | `10.15ms` | `29.31ms` |
| `slow-50ms` | `50/s` for `30s` | `1,501` | `0` | `52.77ms` | `57.12ms` | `64.61ms` | `75.43ms` |
| `ephemeral-noop` | `20/s` for `30s` | `601` | `0` | `19.38ms` | `24.82ms` | `32.01ms` | `51.79ms` |

Total authenticated run:

```text
http_reqs: 17104
http_req_failed: 0.00%
checks_succeeded: 17104 / 17104
```

## Pod Impact

`kubectl top` is sampled by Metrics Server and can lag. Treat these values as
coarse pod-level samples rather than precise instantaneous peaks.

| Moment | CPU | Memory |
| --- | ---: | ---: |
| Before worker route tests | `18m` | `74Mi` |
| Before authenticated rerun | `25m` | `120Mi` |
| Authenticated sampled peak | `528m` | `170Mi` |
| After authenticated run | `20m` | `141Mi` |

Final cgroup/process memory after the authenticated run:

```text
memory.current=181972992
VmSize: 75061428 kB
VmRSS:    185380 kB
RssAnon:  135704 kB
RssFile:   49676 kB
Threads:       9
```

Container health after the run:

```text
restartCount=0
lastState={}
```

## Interpretation

- The public app path is correctly constrained by plugin-gateway rate limiting.
- The worker/app path, isolated with `X-API-Key`, handled the tested rates with
  zero errors.
- `warm-noop` and `echo-1kb` remained low-latency under the selected rates.
- `slow-50ms` is dominated by the intentional 50 ms worker delay.
- `ephemeral-noop` was more CPU-intensive, as expected, but remained well below
  the pod CPU limit and did not OOM/restart.
- Memory increased after loading persistent workers and running ephemeral churn,
  but stayed below the `256Mi` request and far below the `1Gi` limit.

## Next Checks

- Repeat the authenticated worker run after enabling HPA with at least two
  replicas.
- Run a gateway-focused test with an intentionally higher
  `plugins.gateway.rateLimit.requests` value to measure public app capacity
  without bypassing plugin hooks.
- Add a longer soak test to check whether RSS stabilizes after repeated
  ephemeral worker churn.
