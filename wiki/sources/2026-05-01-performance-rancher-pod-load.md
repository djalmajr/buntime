---
title: "Rancher Pod Load Test - 2026-05-01"
audience: ops
sources:
  - apps/runtime/docs/performance-rancher-pod-load-2026-05-01.md (moved 2026-05-02)
updated: 2026-05-01
tags: [source, performance, k6, rancher, report]
status: stable
---

# Rancher Pod Load Test - 2026-05-01

This report documents the external load test executed against the Buntime pod
running in the local Rancher/k3s environment.

## Environment

| Item | Value |
| --- | --- |
| Runtime URL | `https://buntime.home` |
| Tested endpoint | `GET /_/api/health` |
| Namespace | `zomme` |
| Deployment | `buntime` |
| Pod | `buntime-76dcb486b7-w99z8` |
| Replicas | `1` |
| Image | `ghcr.io/zommehq/buntime:runtime-performance-resilience` |
| CPU request / limit | `250m` / `2` |
| Memory request / limit | `256Mi` / `1Gi` |
| Tool | `k6` |
| TLS | `--insecure-skip-tls-verify` because the lab uses local/self-signed TLS |

This test targets the packaged runtime through local DNS, Ingress, TLS, and
Traefik. It is useful for pod impact and edge-path smoke testing, but it does
not exercise worker execution, app code, plugin upload paths, or cold-start
worker churn.

## Load Script

The k6 script used for both runs:

```js
import http from "k6/http";
import { check } from "k6";

const rate = Number(__ENV.RATE || "200");
const duration = __ENV.DURATION || "45s";
const preAllocatedVUs = Number(__ENV.PREALLOCATED_VUS || "40");
const maxVUs = Number(__ENV.MAX_VUS || "200");

export const options = {
  discardResponseBodies: true,
  scenarios: {
    health_constant_rate: {
      executor: "constant-arrival-rate",
      duration,
      rate,
      preAllocatedVUs,
      maxVUs,
      timeUnit: "1s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<250", "p(99)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

const baseUrl = __ENV.RUNTIME_URL || "https://buntime.home";

export default function () {
  const response = http.get(`${baseUrl}/_/api/health`, {
    tags: { endpoint: "health" },
  });

  check(response, {
    "status is 200": (res) => res.status === 200,
  });
}
```

## Commands

Baseline:

```bash
kubectl top pod -n zomme -l app.kubernetes.io/name=buntime --containers
kubectl get pods -n zomme -l app.kubernetes.io/name=buntime -o wide
kubectl get deploy buntime -n zomme \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\nrequests.cpu="}{.spec.template.spec.containers[0].resources.requests.cpu}{" requests.memory="}{.spec.template.spec.containers[0].resources.requests.memory}{"\nlimits.cpu="}{.spec.template.spec.containers[0].resources.limits.cpu}{" limits.memory="}{.spec.template.spec.containers[0].resources.limits.memory}{"\nreplicas="}{.spec.replicas}{"\n"}'
```

200 RPS run:

```bash
RUNTIME_URL=https://buntime.home \
  k6 run --insecure-skip-tls-verify \
  --summary-export /private/tmp/buntime-health-k6-summary.json \
  /private/tmp/buntime-health-k6.js
```

1000 RPS run:

```bash
RATE=1000 DURATION=30s PREALLOCATED_VUS=80 MAX_VUS=250 \
  RUNTIME_URL=https://buntime.home \
  k6 run --insecure-skip-tls-verify \
  --summary-export /private/tmp/buntime-health-k6-1000rps-summary.json \
  /private/tmp/buntime-health-k6.js
```

Pod monitoring during each run:

```bash
for i in 1 2 3 4 5 6 7 8 9 10 11; do
  printf '%s ' "$(date +%H:%M:%S)"
  kubectl top pod -n zomme -l app.kubernetes.io/name=buntime --containers --no-headers
  sleep 3
done
```

Post-run memory and restart checks:

```bash
kubectl exec -n zomme buntime-76dcb486b7-w99z8 -- sh -c \
  'printf "memory.current="; cat /sys/fs/cgroup/memory.current; egrep "^(VmSize|VmRSS|RssAnon|RssFile|Threads):" /proc/1/status'

kubectl get pod buntime-76dcb486b7-w99z8 -n zomme \
  -o jsonpath='{.status.containerStatuses[0].restartCount}{"\n"}{.status.containerStatuses[0].lastState}{"\n"}'
```

## Results

| Run | Duration | Target rate | Actual RPS | Requests | Failures | p50 | p90 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Health smoke | 45s | 200/s | 200.02/s | 9,001 | 0 | 0.861ms | 1.433ms | 1.834ms | 4.09ms | 27.491ms |
| Health pressure | 30s | 1000/s | 998.79/s | 29,964 | 0 | 0.535ms | 0.794ms | 1.010ms | 6.75ms | 138.630ms |

The 1000 RPS run reported `36` dropped iterations in k6. The pod still returned
zero failed HTTP responses. Dropped iterations mean the load generator did not
start every scheduled iteration on time, so that run is already partly measuring
client/lab capacity as well as the Buntime pod.

## Pod Impact

`kubectl top` is sampled by Metrics Server and can lag. Treat these values as
coarse pod-level samples rather than precise instantaneous peaks.

| Moment | CPU | Memory |
| --- | ---: | ---: |
| Baseline before load | `12m` | `37Mi` |
| 200 RPS sampled range | `12m` to `93m` | `36Mi` to `43Mi` |
| 1000 RPS sampled range | `16m` to `129m` | `38Mi` to `49Mi` |
| After all runs | `12m` | `38Mi` |

Final cgroup/process memory after the runs:

```text
memory.current=62627840
VmSize: 74473272 kB
VmRSS:     82764 kB
RssAnon:   35020 kB
RssFile:   47744 kB
Threads:       5
```

Container health after the runs:

```text
restartCount=0
lastState={}
```

## Interpretation

The pod had low resource impact for this endpoint:

- CPU stayed well below the `250m` request even at the highest sampled point
  during the 1000 RPS run.
- Memory returned to the same range observed before the load.
- No OOM, restart, or failed HTTP response was observed.
- The high `VmSize` reported by `/proc/1/status` is virtual address space and
  should not be interpreted as resident memory. Use `kubectl top`,
  `memory.current`, and `VmRSS` for this check.

This result is a good Ingress/API health baseline, not a production capacity
claim. The next meaningful tests should target worker/app execution paths:

- warm persistent worker route,
- 1 KiB POST/echo route,
- slow 50 ms worker route,
- `ttl: 0` ephemeral worker churn,
- plugin upload/reload path with a scoped API key.
