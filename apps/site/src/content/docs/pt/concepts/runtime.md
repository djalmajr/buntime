---
title: Runtime
description: O processo principal do @buntime/runtime — Bun + Hono, fluxo de inicialização, tratamento de requisições e roteamento em camadas.
sidebar:
  order: 1
  label: Runtime
---

Runtime modular para Bun com um pool de workers, sistema de plugins e suporte a
micro-frontends. O processo principal orquestra requisições, mas **nunca executa
código de aplicação** — esse trabalho fica isolado nos workers (veja
[Worker Pool](/pt/concepts/worker-pool/)).

## Stack

| Camada | Tecnologia |
|-------|------------|
| Runtime | Bun (`Bun.serve`, `Worker`, `Bun.file`) |
| Framework HTTP | Hono |
| Validação | Zod |
| Cache LRU | `quick-lru` |
| Versionamento | `semver` |
| Documentação da API | `hono-openapi`, `@scalar/hono-api-reference` |

## Estrutura do código

```
apps/runtime/src/
├── index.ts            # Entry: Bun.serve + graceful shutdown
├── api.ts              # Initializes logger, config, pool, plugins, routes
├── app.ts              # Hono app: CSRF, hooks, request resolution
├── config.ts           # Loads RUNTIME_* env vars
├── constants.ts        # Zod validation of PORT/NODE_ENV, BodySizeLimits
├── libs/pool/          # WorkerPool, WorkerInstance, wrapper
├── plugins/            # PluginLoader, PluginRegistry
├── routes/             # apps, health, plugins, admin, worker
└── utils/              # request, serve-static, get-entrypoint, get-worker-dir
```

## Fluxo de inicialização

A inicialização acontece em camadas, cada uma dependendo da anterior:

| Passo | Módulo | Responsabilidade |
|------|--------|----------------|
| 1 | `constants.ts` | Valida `PORT`, `NODE_ENV`, `DELAY_MS`; define `IS_DEV`, `IS_COMPILED` |
| 2 | `config.ts` | Resolve `RUNTIME_WORKER_DIRS` (obrigatório), `RUNTIME_PLUGIN_DIRS`, `RUNTIME_POOL_SIZE` |
| 3 | `loader.ts` | Varre `pluginDirs`, lê `manifest.yaml`, filtra `enabled`, ordena por dependências |
| 4 | `api.ts` | Cria o logger, `WorkerPool`, `PluginRegistry`, monta as rotas core e o `app` Hono |
| 5 | `index.ts` | Inicia `Bun.serve`, executa `runOnServerStart`, registra o handler de `SIGINT` |

### Diferenças entre ambientes

| Aspecto | Desenvolvimento | Produção |
|--------|-------------|----------|
| `poolSize` | 10 | 500 |
| Logger | `pretty` (colorido) | `json` (estruturado) |
| Nível de log | `debug` | `info` |
| HMR | Habilitado | Desabilitado |

Outros padrões: `staging` = 50 workers, `test` = 5.

## Núcleo do servidor

`Bun.serve` é configurado em `index.ts` com algumas particularidades operacionais:

| Opção | Valor | Motivo |
|--------|-------|--------|
| `idleTimeout` | `0` | Desabilita o timeout para que conexões SSE/WebSocket permaneçam abertas |
| `routes["/favicon.ico"]` | `204 No Content` | Evita 404s nos logs |
| `routes` | `pluginRoutes` | `server.routes` agregadas dos plugins |
| `development.hmr` | `true` (dev) | Hot Module Replacement |
| `websocket` | combinado | Handler único que agrega todos os plugins |

### Encerramento gracioso (graceful shutdown)

`SIGINT` dispara um pipeline com timeout total de 30s (`SHUTDOWN_TIMEOUT_MS`):

1. Arma um temporizador de saída forçada (`process.exit(1)` em 30s).
2. `registry.runOnShutdown()` — hooks de plugins em ordem reversa (LIFO).
3. `pool.shutdown()` — termina todos os workers.
4. `logger.flush()`.
5. `clearTimeout` + `process.exit(0)`.

Qualquer falha na cadeia cai no bloco `catch` e força o código de saída 1.

## Tratamento de requisições

### Pipeline em `app.ts`

```
Request -> CSRF (/api/*) -> onRequest hooks -> server.fetch -> plugin.routes
        -> plugin app (worker) -> worker app -> onResponse hooks -> Response
```

### CSRF

Aplicado a `/api/*` para métodos que alteram estado (POST, PUT, PATCH, DELETE):

| Condição | Comportamento |
|-----------|----------|
| Método em `[GET, HEAD, OPTIONS]` | Ignora (bypass) |
| Header `X-Buntime-Internal: true` | Ignora (bypass) (worker → runtime) |
| `Sec-Fetch-Mode` presente sem `Origin` | 403 |
| `Origin.host !== request.host` | 403 |

### Limites de tamanho do corpo (body size)

Constantes em `constants.ts`: `DEFAULT = 10MB`, `MAX = 100MB`. Configuráveis via
env (`BODY_SIZE_DEFAULT`, `BODY_SIZE_MAX`) e por worker no `manifest.yaml`
(`maxBodySize: 50mb`). Se `maxBodySize > MAX`, o runtime emite um aviso e
usa `MAX`.

A validação acontece em duas etapas:

1. Caminho rápido: `Content-Length` inválido ou maior que o limite → `413 Payload Too Large`.
2. Caminho lento (chunked): leitura completa, reverificação do tamanho real.

Tudo retorna `BodyTooLargeError` no código de aplicação. A resposta
inclui o header `X-Request-Id` para correlação de logs.

### Reescrita de URL

`rewriteUrl(url, basePath)` remove o prefixo do caminho preservando a query
string — usado antes de injetar no worker. A função assume que o caminho
começa com `basePath` (validado na camada anterior).

| Entrada | Resultado |
|-------|--------|
| `basePath = ""` | Retorna o pathname original |
| `pathname === basePath` | Retorna `"/"` |
| `pathname` não começa com `basePath` | Comportamento indefinido — valide na camada anterior |

### Headers especiais

| Header | Direção | Descrição |
|--------|-----------|-------------|
| `X-Base` | runtime → worker | Caminho base injetado para SPAs |
| `X-Buntime-Internal` | worker → runtime | Ignora o CSRF |
| `X-Not-Found` | runtime → shell | Sinaliza renderização consistente de 404 |
| `X-Request-Id` | bidirecional | UUID de correlação |

## Roteamento — em camadas

A resolução em `app.ts` segue uma ordem de prioridade estrita. Rotas mais
específicas (plugins) têm precedência sobre as genéricas (workers):

| Ordem | Camada | Exemplo |
|-------|-------|---------|
| 1 | CSRF | Bloqueia antes de tudo |
| 2 | Modo app-shell | `shouldRouteToShell()` intercepta a navegação |
| 3 | Hooks `onRequest` | Auth, rate limiting, métricas |
| 4 | APIs do runtime | `/api/*` (ou `/_/api/*` com `RUNTIME_API_PREFIX`) |
| 5 | `plugin.server.fetch` | Handler direto do plugin |
| 6 | `plugin.routes` | Hono montado em `plugin.base`, ordenado por especificidade (caminho mais longo primeiro) |
| 7 | Apps de plugin | Worker pool (iframes z-frame) |
| 8 | Apps de worker | `/:app/*` em `workerDirs` |
| 9 | Fallback da homepage | Tenta servir a partir de `homepage.app` |
| 10 | 404 | Texto `Buntime v{version}` ou 404 do shell |

### Roteamento do shell

`shouldRouteToShell(req)` decide se a navegação vai para o shell (cpanel):

| Condição | Resultado |
|-----------|--------|
| `Sec-Fetch-Mode !== "navigate"` | Rejeita (fetch/XHR não passa pelo shell) |
| Caminho contém `/api/` | Rejeita |
| Caminho é `/` ou vazio | Aceita |
| Caminho corresponde a `plugin.base` | Aceita |

Roda **depois** de `onRequest`, permitindo que a auth seja processada antes da
decisão de roteamento.

### Apps de worker com semver

Workers ficam em `workerDirs` em dois formatos:

```
# Flat
apps/my-app@1.0.0/

# Nested
apps/my-app/1.0.0/
```

A resolução de versão usa `semver`:

| Requisição | Resolve para |
|---------|-------------|
| `/my-app/*` | `latest` se existir, caso contrário a versão mais alta |
| `/my-app@1/*` | A maior `1.x.x` |
| `/my-app@1.0/*` | A maior `1.0.x` |
| `/my-app@1.0.0/*` | Versão exata |
| `/my-app@^1.0.0/*` | Faixa (range) semver |
| `/my-app@latest/*` | Diretório `latest` literal |

### Detecção de entrypoint

`getEntrypoint(appDir, manifestEntry?)` aplica a prioridade:

1. `entrypoint` do `manifest.yaml`.
2. Descoberta automática: `index.html` → `index.ts` → `index.js` → `index.mjs`.

| Tipo | `static` | Execução |
|------|----------|-----------|
| `index.html` | `true` | `serveStatic` + injeção de `<base href>` |
| `index.{ts,js,mjs}` | `false` | Carregado como worker, executa `fetch()` ou `routes` |

`serveStatic` valida path traversal (`resolve()` deve permanecer dentro de
`baseDir`) e faz fallback para `entrypoint` no roteamento de SPA.

### Fallback da homepage

Quando uma `homepage = { app, base: "/" }` está configurada, requisições que
retornam 404 dos workers tentam ser servidas pelo app da homepage. Útil para
SPAs na raiz que precisam carregar chunks com caminhos arbitrários.

## Caminhos reservados

Plugins externos não podem ocupar:

- `/api`
- `/health`
- `/.well-known`

Os caminhos base dos plugins devem corresponder a `/[a-zA-Z0-9_-]+`.

## Rotas da API core

| Rota | Método | Descrição |
|-------|--------|-------------|
| `/api/health` | GET | Saúde geral |
| `/api/health/ready` | GET | Readiness probe (k8s) |
| `/api/health/live` | GET | Liveness probe (k8s) |
| `/api/workers` | GET | Lista workers em `workerDirs` |
| `/api/workers/upload` | POST | Upload de tarball/zip |
| `/api/workers/:scope/:name[/:version]` | DELETE | Remove worker/versão |
| `/api/plugins` | GET | Lista plugins no sistema de arquivos |
| `/api/plugins/loaded` | GET | Lista plugins carregados |
| `/api/plugins/reload` | POST | Re-varre e recarrega |
| `/api/plugins/upload` | POST | Upload de um plugin |
| `/api/plugins/:name` | DELETE | Remove um plugin |
| `/api/admin/session` | GET | Valida `X-API-Key`, retorna permissões |
| `/api/keys` | GET/POST | Lista/cria chaves de API |
| `/api/keys/:id` | DELETE | Revoga uma chave |
| `/api/openapi.json` | GET | Spec OpenAPI 3.1 |
| `/api/docs` | GET | UI do Scalar |

Detalhes completos na [Referência da API do Runtime](/pt/reference/api/).

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|---------|-------------|
| `PORT` | `8000` | Porta HTTP |
| `NODE_ENV` | `development` | `development` \| `production` \| `staging` \| `test` |
| `RUNTIME_WORKER_DIRS` | **obrigatório** | Diretórios de apps (estilo PATH, `:`) |
| `RUNTIME_PLUGIN_DIRS` | `./plugins` | Diretórios de plugins |
| `RUNTIME_POOL_SIZE` | baseado no env | Tamanho máximo do pool |
| `RUNTIME_EPHEMERAL_CONCURRENCY` | `2` | Concorrência máxima para `ttl: 0` |
| `RUNTIME_EPHEMERAL_QUEUE_LIMIT` | `100` | Fila máxima para `ttl: 0` antes de 503 |
| `RUNTIME_WORKER_CONFIG_CACHE_TTL_MS` | `1000` | TTL do cache do manifest |
| `RUNTIME_WORKER_RESOLVER_CACHE_TTL_MS` | `1000` | TTL do cache do resolver |
| `RUNTIME_LOG_LEVEL` | `info` (prod) / `debug` (dev) | Nível de log |
| `RUNTIME_API_PREFIX` | (vazio) | Move a API interna: `""` → `/api`, `"/_"` → `/_/api` |
| `RUNTIME_ROOT_KEY` | (opcional) | Chave root de bootstrap (principal `root` sintético, acesso total) |
| `RUNTIME_STATE_DIR` | (opcional) | Onde armazenar `api-keys.db` (bun:sqlite) |
| `DELAY_MS` | `100` | Atraso antes de terminar um worker |

:::note
Variáveis com múltiplos valores **sempre** usam `:` (estilo PATH), nunca
vírgulas. Isso se aplica a `RUNTIME_WORKER_DIRS` e `RUNTIME_PLUGIN_DIRS`.
:::

A tabela completa — incluindo as variáveis dos core-plugins — fica em
[Operações → Variáveis de ambiente](/pt/ops/environment/).

## Princípios de design

1. **A thread principal orquestra, nunca executa código de app.** Crashes de worker não derrubam o runtime.
2. **Workers impõem isolamento** — heap, módulos e env separados por instância.
3. **O pipeline de plugins intercepta** requisição/resposta sem acoplar os plugins entre si.
4. **Injeção de caminho base (base-path)** habilita SPAs em subcaminhos sem reconfigurar bundlers.
5. **Ordenação topológica** organiza os plugins por dependências antes de `onInit`.

## Relacionado

- [Worker Pool](/pt/concepts/worker-pool/) — LRU, ciclo de vida, TTL deslizante, concorrência efêmera.
- [Sistema de Plugins](/pt/concepts/plugin-system/) — hooks, modos persistente vs serverless, manifest.
- [Arquitetura de Micro-Frontend](/pt/concepts/micro-frontend/) — z-frame, MessageChannel, isolamento.
- [Referência da API do Runtime](/pt/reference/api/) — endpoints, autenticação, exemplos com curl.
