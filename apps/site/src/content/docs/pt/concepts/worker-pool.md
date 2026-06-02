---
title: Worker Pool
description: O pool LRU de workers Bun isolados — ciclo de vida, TTL deslizante, concorrência efêmera, isolamento e métricas.
sidebar:
  order: 2
---

O componente central do runtime. Ele gerencia o ciclo de vida dos workers Bun
que executam as aplicações dos usuários em isolamento, oferecendo reuso por meio
de um cache LRU, verificações de saúde, métricas e desligamento gracioso. Sem
ele, cada requisição iniciaria um worker do zero.

Para o pipeline de roteamento que precede o pool, veja
[Runtime](/pt/concepts/runtime/). Para plugins que se conectam ao pool via
`onWorkerSpawn`/`onWorkerTerminate`, veja [Sistema de Plugins](/pt/concepts/plugin-system/).

## Arquitetura

```
src/libs/pool/
├── pool.ts        # WorkerPool — LRU management, metrics
├── instance.ts    # WorkerInstance — IPC + individual lifecycle
├── wrapper.ts     # Code that runs inside the worker
├── config.ts      # Loading + validation of manifest.yaml
├── metrics.ts     # PoolMetrics
├── stats.ts       # Calculation helpers (avgResponseTime, etc.)
└── types.ts       # WorkerMessage, WorkerResponse, WorkerConfig
```

| Componente | Responsabilidade |
|-----------|----------------|
| `WorkerPool` | Cache LRU (`quick-lru`), criação sob demanda, eviction, timers de saúde |
| `WorkerInstance` | Spawn `new Worker(wrapper.ts)`, IPC `postMessage`, timeout, status |
| `wrapper.ts` | Executa na thread do worker: `import(ENTRYPOINT)`, processa mensagens, injeta `<base href>` |

### Fluxo de execução

```
Request → pool.fetch(appDir, config, req) → getOrCreate(key)
            ├─ Cache hit → instance.fetch(req)
            └─ Cache miss → new WorkerInstance → await READY → cache.set(key, …)
```

O ponto de entrada público é `pool.fetch()`. `getOrCreate()` é privado e
gerencia o cache — não o contorne.

## Ciclo de vida do worker

```
Creating → Ready → Active ⇄ Idle → Terminated
```

| Estado | Condição |
|-------|-----------|
| `Creating` | `new Worker()` disparado, aguardando `READY` |
| `Ready` | Worker carregou o módulo, validou os exports, enviou `READY` |
| `Active` | Última requisição há menos de `idleTimeoutMs` |
| `Idle` | Última requisição há mais de `idleTimeoutMs` (o worker permanece vivo) |
| `Ephemeral` | Modo `ttl=0` — criado e destruído por requisição |
| `Offline` | Encerrado ou com falha crítica |

### Protocolo IPC

Mensagens estruturadas via `postMessage` com uma `transferList` para zero-copy:

```ts
// Main → Worker
type WorkerMessage =
  | { type: "REQUEST"; reqId: string; req: SerializedRequest }
  | { type: "IDLE" }
  | { type: "TERMINATE" };

// Worker → Main
type WorkerResponse =
  | { type: "READY" }
  | { type: "RESPONSE"; reqId: string; res: SerializedResponse }
  | { type: "ERROR"; reqId: string; error: string; stack?: string };
```

Os corpos de Request/Response trafegam como um `ArrayBuffer` transferível,
evitando cópias.

## Namespaces — endereçamento `@namespace/app`

Workers são endereçados por nome na URL. Um worker com namespace (escopo npm)
`@namespace/app` — armazenado em `<workerDir>/@namespace/app/<version>/` — é
servido em **`/@namespace/app/...`** (mantenha o `@`). Um worker sem escopo `app`
é servido em `/app/...`. Namespaces dão a equipes/ambientes um contexto separado:
`@example/checkout`, `@staging/api`, `@production/api`.

Esse é um agrupamento *lógico* ortogonal ao suporte *físico* a múltiplos
diretórios (`RUNTIME_WORKER_DIRS`): um namespace pode residir em qualquer
diretório de workers, e o resolver percorre todos eles. Plugins diferem — eles
declaram um `base` explícito de segmento único em seu manifesto, então o `@scope`
deles afeta apenas armazenamento/listagem, não a URL servida.

## Habilitando / desabilitando uma versão de worker

`manifest.enabled` (padrão `true`) controla se uma versão de worker é servida.
Quando `false`, a versão é tratada como não instalada e o caminho base retorna
404 — sem necessidade de reiniciar o processo. Alterne via
`POST /api/workers/:scope/:name/:version/{enable,disable}`; o endpoint edita o
manifesto da versão e limpa o cache de configuração do worker, de modo que a
próxima requisição reflita a mudança.

## TTL — deslizante, não fixo

A política de TTL define toda a personalidade de um worker:

| Política | Comportamento |
|--------|----------|
| `ttl = 0` | **Efêmero**: o worker é descartado após cada requisição. Boot por chamada. Latência mais alta. Use para handlers stateless no estilo lambda. |
| `ttl > 0` | **Persistente**: o worker é reutilizado. O TTL é **deslizante** — ele é reiniciado a cada requisição via `touch()`. Use para aplicações com estado, conexões de BD, SSE, WebSocket. |

:::caution[TTL deslizante]
Um worker persistente permanece vivo enquanto receber tráfego. Ele só é
encerrado quando `ttlMs` decorre sem requisições, ou quando `maxRequests` é
atingido. Não é um TTL absoluto contado a partir do momento de criação.
:::

### `idleTimeout` — apenas notificação

`idleTimeout` **não** encerra o worker. Ele apenas dispara o evento `onIdle` na
aplicação, dando a ela a chance de fazer uma limpeza parcial (fechar conexões de
BD, esvaziar caches). O worker permanece no cache até que o TTL realmente expire.

```ts
export default {
  fetch(req) { /* ... */ },
  onIdle() {
    // Opportunistic cleanup — worker stays alive
    db.releaseConnection();
  },
  onTerminate() {
    // Before actual termination
    db.close();
  },
};
```

### Regras quando `ttl > 0`

- `ttl >= timeout`
- `idleTimeout >= timeout`
- Se `idleTimeout > ttl`, o runtime o ajusta para `ttl` com um aviso.

### `maxRequests` — rede de segurança

Um limite rígido de requisições por worker, independente do TTL. Útil para
mitigar vazamentos de memória que se acumulam ao longo de horas. Padrão: `1000`.

## Manifesto da aplicação worker

`manifest.yaml` no diretório da aplicação define a configuração do worker:

```yaml
entrypoint: index.ts        # Default: auto-discovery
timeout: 30                 # or "30s", "5m", "1h"
ttl: 0                      # 0 = ephemeral
idleTimeout: 60             # notification only
maxRequests: 1000           # safety net
maxBodySize: "10mb"         # or a number in bytes
lowMemory: false            # Bun --smol
autoInstall: false          # bun install --frozen-lockfile --ignore-scripts
visibility: public          # public | protected | internal
publicRoutes:               # auth bypass
  - /health
  - /api/public/**
env:                        # custom vars (filtered for sensitive values)
  API_URL: https://api.example.com
```

Formatos de duração suportados para `timeout`, `ttl`, `idleTimeout`: `ms`, `s`,
`m`, `h`, `d`, `w`, `y`.

## Variáveis de ambiente passadas aos workers

Os workers **não herdam** o ambiente do runtime. Eles recebem apenas:

| Variável | Origem |
|----------|--------|
| `APP_DIR` | runtime — caminho absoluto para a aplicação |
| `ENTRYPOINT` | runtime — caminho do entrypoint |
| `WORKER_ID` | runtime — UUID único |
| `WORKER_CONFIG` | runtime — JSON de `WorkerConfig` |
| `NODE_ENV` | herdada |
| `RUNTIME_*` | herdadas (`RUNTIME_WORKER_DIRS`, `RUNTIME_PLUGIN_DIRS`, `RUNTIME_LOG_LEVEL`) |
| `RUNTIME_API_URL` | runtime — URL interna (ex.: `http://127.0.0.1:8000`) |
| `*` (de `manifest.env`) | manifesto — após filtrar padrões sensíveis |
| `*` (de `.env`) | arquivo `.env` em `appDir` — sobrescreve `manifest.env` |

### Padrões bloqueados

Variáveis que correspondam a qualquer padrão abaixo são removidas antes de
chegar ao worker, com um aviso no log:

| Padrão | Exemplo |
|---------|---------|
| `^(DATABASE\|DB)_` | `DATABASE_URL`, `DB_HOST` |
| `^(API\|AUTH\|SECRET\|PRIVATE)_?KEY` | `API_KEY`, `AUTH_KEY` |
| `_TOKEN$` | `ACCESS_TOKEN` |
| `_SECRET$` | `JWT_SECRET` |
| `_PASSWORD$` | `DB_PASSWORD` |
| `^AWS_` / `^GITHUB_` / `^OPENAI_` / `^ANTHROPIC_` / `^STRIPE_` | Credenciais de provedores |

## Isolamento

Cada worker é executado em uma thread separada com:

- **Heap independente** — GC separado, sem vazamentos entre aplicações.
- **Cache de módulos próprio** — versões diferentes do mesmo pacote coexistem.
- **Ambiente com escopo** — `Bun.env` injetado no momento do spawn, sem poluição global.
- **Modo `smol`** opcional via `lowMemory: true` (heap menor, GC mais agressivo).
- **Path traversal bloqueado** — o entrypoint é validado para permanecer dentro de `APP_DIR`.

## Detecção de colisões

O pool indexa os workers pela chave `name@version`. A mesma aplicação aparecendo
em dois `workerDirs` diferentes, ou duas aplicações com a mesma chave, resulta em
erro:

```
Worker collision: "my-app@1.0.0" already registered from "/apps/my-app/v1",
cannot register from "/other/my-app/v1"
```

## Verificações de saúde

Um timer periódico por worker. A cada verificação, `instance.isHealthy()` valida:

| Critério | Condição |
|-----------|-----------|
| TTL deslizante | `(now - ttlStartAt) < ttlMs` |
| Requisições | `requestCount < maxRequests` |
| Erros críticos | `hasCriticalError === false` |

Falha em qualquer critério → `pool.retire(key)` (remove do cache + encerra).

Intervalo do timer: `Math.min(idleTimeoutMs, ttlMs) / 2`.

### Erros críticos

Estes marcam um worker como permanentemente não saudável:

- Timeout de inicialização (`READY` não recebido em até 30s).
- Erro de import (erro de sintaxe, módulo não encontrado).
- Erro não tratado durante uma requisição.

## Controle de concorrência efêmera

Para aplicações com `ttl=0`, o pool impõe dois limites globais:

| Variável | Padrão | Propósito |
|----------|---------|---------|
| `RUNTIME_EPHEMERAL_CONCURRENCY` | `2` | Requisições simultâneas em andamento |
| `RUNTIME_EPHEMERAL_QUEUE_LIMIT` | `100` | Profundidade da fila antes de retornar `503` |

O estouro da fila retorna `503 Service Unavailable`. Ajuste de acordo com o custo
de boot da aplicação — aplicações com inicialização cara não devem usar `ttl=0`
sob carga pesada.

## Métricas

`pool.getMetrics()` expõe contadores de todo o pool: `activeWorkers`,
`avgResponseTimeMs`, `hitRate`/`hits`/`misses`, `evictions`,
`ephemeralConcurrency`/`ephemeralQueueDepth`/`ephemeralQueueLimit`,
`memoryUsageMB`, `requestsPerSecond` e os contadores vitalícios `total*`.

`worker.getStats()` expõe por instância: `ageMs`, `idleMs`, `requestCount`,
`errorCount`, `avgResponseTimeMs`, `status`, `totalResponseTimeMs`.

## Aplicação worker — formatos de export suportados

`wrapper.ts` aceita três formas de export padrão:

```ts
// 1. Fetch handler
export default {
  fetch(req: Request) { return new Response("ok"); },
};

// 2. Routes object (converted to Hono internally)
export default {
  routes: {
    "/": new Response("Home"),
    "/api/posts/:id": {
      GET: (req) => new Response(`Post ${req.params.id}`),
      DELETE: () => new Response(null, { status: 204 }),
    },
    "/file": Bun.file("./public/index.html"),
  },
};

// 3. SPA — set entrypoint: index.html; the wrapper serves it statically
//    with <base href> injection. index.ts is NOT executed in this mode.
```

## Boas práticas

| Faça | Evite |
|----|-------|
| `ttl > 0` para aplicações com estado ou conexões caras | `ttl = 0` para aplicações com warmup pesado |
| `idleTimeout` para limpeza parcial via `onIdle` | Confiar no `idleTimeout` para encerrar o worker |
| `maxRequests` como rede de segurança | Estado global no worker (perdido na reciclagem) |
| `timeout` apropriado para operações lentas | `autoInstall` em produção (pré-instale em vez disso) |
| Ajustar `RUNTIME_EPHEMERAL_*` sob carga | `ttl = 0` ilimitado sob tráfego em rajadas |

Para estado compartilhado, externalize-o (ex.: [`@buntime/plugin-keyval`](/pt/plugins/keyval/)
em vez de um `Map` global no worker).

## Relacionados

- [Runtime](/pt/concepts/runtime/) — pipeline de requisições, variáveis de ambiente, inicialização.
- [Sistema de Plugins](/pt/concepts/plugin-system/) — hooks `onWorkerSpawn`/`onWorkerTerminate`.
- [Referência da API do Runtime](/pt/reference/api/) — endpoints `/api/workers/*`.
