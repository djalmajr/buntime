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

## Interpretação

Este teste é um gate de regressão local, não um teste de capacidade do cluster. Ele mede o caminho direto do runtime (`app.fetch`) com fixtures temporárias de worker, cobrindo roteamento, resolução de worker, cache/config, pool dispatch, body cloning e transferência de resposta, mas sem overhead de Ingress, TLS, rede, Traefik ou limites reais de CPU/memória do pod.

Conclusão:
- O runtime passou no gate curto de performance.
- O caminho warm/persistente ficou estável e sem erros.
- O cenário `ephemeral-noop` também passou; ele é o mais sensível a churn de cold start e usa limite de concorrência efêmera.
- A pipeline local do GitLab permanece sem performance por decisão operacional: ela deve apenas gerar e publicar imagem para o Rancher detectar.

## Próximos testes recomendados

- Rodar `bun run perf:gate` localmente antes de mudanças maiores no pool/worker routing.
- Rodar uma variante HTTP (`PERF_MODE=http`) para medir overhead de socket local.
- Criar um job manual separado no GitLab local para performance, sem bloquear a pipeline de imagem.
- Executar carga externa contra `https://buntime.home` com token de teste legítimo para medir Ingress, TLS, Traefik e limites reais do pod.
