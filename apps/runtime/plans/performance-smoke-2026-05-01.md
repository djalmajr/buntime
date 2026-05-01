# Performance smoke - runtime local

Data: 2026-05-01

Ambiente:
- Branch: `runtime-performance-resilience`
- Comando: `bun run perf:ci`
- Diretório: `apps/runtime`
- Modo: `PERF_MODE=direct`
- Duração medida: `1000ms` por cenário
- Warmup: `200ms` por cenário
- Concorrência: `5`
- Pool size: `10`
- Gate: `perf/thresholds.json`
- Relatório gerado: `apps/runtime/perf-results.json` (ignorado pelo Git)

## Resultado

O gate de performance passou com zero erros.

| Cenário | Reqs | RPS | Erros | p50 ms | p95 ms | p99 ms | Threshold p95 | Threshold p99 |
|---------|------|-----|-------|--------|--------|--------|---------------|---------------|
| `warm-noop` | 19477 | 19477 | 0 | 0.22 | 0.43 | 1.15 | 100 | 250 |
| `echo-1kb` | 19188 | 19188 | 0 | 0.23 | 0.39 | 1.09 | 120 | 300 |
| `slow-50ms` | 100 | 100 | 0 | 51.76 | 52.51 | 52.77 | 250 | 500 |
| `ephemeral-noop` | 113 | 113 | 0 | 45.77 | 51.92 | 54.47 | 1000 | 1500 |

Pool metrics ao final:
- `activeWorkers`: 3
- `hitRate`: 99.69%
- `hits`: 44729
- `misses`: 140
- `totalRequests`: 44869
- `totalWorkersCreated`: 140
- `totalWorkersFailed`: 0
- `memoryUsageMB`: 8.22
- `ephemeralConcurrency`: 2
- `ephemeralQueueDepth`: 0

## Gate completo HTTP

Comando executado:

```bash
PERF_PORT=43188 bun run perf:gate
```

Observacao: a primeira tentativa dentro do sandbox falhou ao abrir uma porta local (`EADDRINUSE`). A execucao foi repetida fora do sandbox com porta fixa e passou.

| Cenário | Conc | Reqs | RPS | Erros | p50 ms | p95 ms | p99 ms | Avg ms | Max ms |
|---------|------|------|-----|-------|--------|--------|--------|--------|--------|
| `warm-noop` | 50 | 165696 | 16569.6 | 0 | 2.55 | 5.32 | 6.71 | 3.02 | 29.59 |
| `echo-1kb` | 50 | 149941 | 14994.1 | 0 | 2.93 | 5.75 | 7.14 | 3.33 | 28.62 |
| `slow-50ms` | 50 | 9100 | 910 | 0 | 54.95 | 57.5 | 59.88 | 55.03 | 61.4 |
| `ephemeral-noop` | 10 | 1004 | 100.4 | 0 | 95.66 | 125.19 | 150.25 | 100.06 | 162.28 |

Pool metrics HTTP:
- `activeWorkers`: 3
- `hitRate`: 99.69%
- `hits`: 389957
- `misses`: 1209
- `totalRequests`: 391166
- `totalWorkersCreated`: 1209
- `totalWorkersFailed`: 0
- `memoryUsageMB`: 10.12
- `requestsPerSecond`: 8094.99

## Gate completo direct

Comando executado:

```bash
PERF_MODE=direct PERF_GATE_FILE=perf/thresholds.json PERF_OUTPUT_FILE=perf-direct-gate-results.json bun scripts/perf.ts
```

| Cenário | Conc | Reqs | RPS | Erros | p50 ms | p95 ms | p99 ms | Avg ms | Max ms |
|---------|------|------|-----|-------|--------|--------|--------|--------|--------|
| `warm-noop` | 50 | 222038 | 22203.8 | 0 | 2.07 | 3.33 | 4.57 | 2.25 | 38.16 |
| `echo-1kb` | 50 | 204004 | 20400.4 | 0 | 2.29 | 3.57 | 4.76 | 2.45 | 10.46 |
| `slow-50ms` | 50 | 9250 | 925 | 0 | 53.98 | 55.29 | 57.44 | 54.13 | 66.6 |
| `ephemeral-noop` | 10 | 1012 | 101.2 | 0 | 96.48 | 120.03 | 129.59 | 99.21 | 138.46 |

Pool metrics direct:
- `activeWorkers`: 3
- `hitRate`: 99.76%
- `hits`: 515146
- `misses`: 1226
- `totalRequests`: 516372
- `totalWorkersCreated`: 1226
- `totalWorkersFailed`: 0
- `memoryUsageMB`: 13.32
- `requestsPerSecond`: 10690.93

Comparacao:
- `warm-noop`: HTTP teve p95 5.32ms contra 3.33ms no direct; throughput HTTP ficou ~25.4% menor.
- `echo-1kb`: HTTP teve p95 5.75ms contra 3.57ms no direct; throughput HTTP ficou ~26.5% menor.
- `slow-50ms`: diferenca pequena; o tempo de 50ms do worker domina a latencia.
- `ephemeral-noop`: diferenca pequena; cold-start/churn e limite de concorrencia efemera dominam.

## Interpretação

Estes testes são gates de regressão locais, não testes de capacidade do cluster. Eles usam fixtures temporárias de worker e cobrem roteamento, resolução de worker, cache/config, pool dispatch, body cloning e transferência de resposta. O modo `http` adiciona parsing HTTP e socket local; nenhum dos dois inclui Ingress, TLS, Traefik, rede real ou limites de CPU/memória do pod.

Conclusão:
- O runtime passou no gate curto, no gate completo HTTP e no gate completo direct.
- O caminho warm/persistente ficou estável e sem erros nos dois modos.
- O overhead HTTP local é visível nos cenários quentes, com p95 ~60% maior e throughput ~25% menor versus direct.
- O cenário `ephemeral-noop` também passou; ele é o mais sensível a churn de cold start e usa limite de concorrência efêmera.
- A pipeline local do GitLab permanece sem performance por decisão operacional: ela deve apenas gerar e publicar imagem para o Rancher detectar.

## Próximos testes recomendados

- Criar um job manual separado no GitLab local para performance, sem bloquear a pipeline de imagem.
- Executar carga externa contra `https://buntime.home` com token de teste legítimo para medir Ingress, TLS, Traefik e limites reais do pod.
