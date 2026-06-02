---
title: Armazenamento
description: Onde o runtime Buntime e os plugins persistem dados — SQL durável via plugin-turso, tabelas do KeyVal, stores em arquivo e caches em memória.
sidebar:
  order: 5
---

Inventário canônico de **onde** o runtime e os plugins persistem dados. O SQL
durável é fornecido por [`@buntime/plugin-turso`](/pt/plugins/turso/), apoiado pelo
Turso Database. O Helm chart do runtime expõe valores gerados `plugins.turso.*`.
O sistema de arquivos (com PVCs no Helm) carrega o código (aplicações + plugins)
e um único store em arquivo (chaves de API). A seção [tabelas do KeyVal](#keyval-tables)
abaixo documenta o schema que `@buntime/plugin-keyval` cria através do `plugin-turso`.

## Princípios

- **SQL durável apenas via Turso.** O Buntime converge para o Turso Database como
  o único driver de SQL durável. Referências anteriores a adaptadores
  LibSQL/SQLite/Postgres/MySQL são detalhes legados de implementação destinados à
  remoção, não a superfície desejada de longo prazo.
- **Turso para estado de plugin gravável e concorrente.** Estado operacional de
  plugin que pode receber escritas concorrentes de admin/API usa o engine do
  Turso Database, não `bun:sqlite`, porque o Turso suporta MVCC e
  `BEGIN CONCURRENT`. `bun:sqlite` é excelente para acesso local rápido ao SQLite
  e o WAL melhora os leitores concorrentes, mas o WAL do SQLite ainda permite
  apenas um escritor por vez.
- **Provedor Turso compartilhado para SQL durável.** Plugins que precisam de SQL
  durável dependem de `@buntime/plugin-turso`. O plugin consumidor é dono do seu
  schema e migrações, enquanto o `plugin-turso` é dono da conexão, sincronização,
  configuração de MVCC e política de retry.
- **Gateway/proxy não devem depender do KeyVal, e o KeyVal não deve depender de
  infraestrutura não relacionada.** `plugin-gateway`, `plugin-proxy` e
  `plugin-keyval` usam, cada um, `@buntime/plugin-turso` diretamente para seu
  armazenamento durável. Isso mantém o gateway/proxy habilitáveis de forma
  independente e mantém o KeyVal como um plugin de funcionalidade KV, não como
  infraestrutura obrigatória para plugins de borda não relacionados.
- **Alvo Kubernetes = Turso Sync.** Arquivos locais de banco Turso são aceitáveis
  para testes locais e deployments de pod único. Deployments Kubernetes são
  projetados em torno do Turso Sync, de modo que cada pod possua seu próprio
  arquivo de banco local e sincronize com um servidor de sync remoto em vez de
  compartilhar o mesmo arquivo de banco através de um volume RWX.
- **Sem novo trabalho multi-adaptador.** Não expanda nenhuma abstração de
  adaptador. O alvo do runtime é um único driver de SQL durável: Turso.
- **Store em arquivo apenas onde a sessão/processo exige.** O único store crítico
  em arquivo é o store de chaves de API do runtime, precisamente porque ele
  precisa existir antes de qualquer plugin ser carregado (bootstrap de
  admin/CLI).
- **Sistema de arquivos persistente = PVC.** No Helm chart, `/data/apps` e
  `/data/plugins` são montados como PVCs separados; perder qualquer um resulta em
  um runtime sem aplicações ou sem plugins customizados.

## Stores conhecidos

| Store | Backend | Dono | Caminho / URL | Conteúdo |
|-------|---------|-------|------------|----------|
| **plugin-turso** | Provedor Turso Database local/sync | `@buntime/plugin-turso` | Caminho do BD local mais URL/token de sync opcional | Ciclo de vida compartilhado de conexão/sync para consumidores de SQL durável |
| **plugin-keyval** | `@buntime/plugin-turso` | `@buntime/plugin-keyval` | Tabelas `kv_entries` e `kv_*` relacionadas através do `plugin-turso` (veja [tabelas do KeyVal](#keyval-tables)) | KV genérico (chaves compostas, TTL, versionstamps); serviço opcional para consumidores que explicitamente precisam de KV |
| **filas do plugin-keyval** | `@buntime/plugin-turso` | `@buntime/plugin-keyval` | Tabelas `kv_queue` + `kv_dlq` | Filas FIFO com locking, retry/backoff, DLQ |
| **busca do plugin-keyval** | `@buntime/plugin-turso` | `@buntime/plugin-keyval` | Tabela `kv_indexes` + tabelas de busca regulares (`kv_fts_<prefix>`) | Índices de busca por prefixo |
| **métricas do plugin-keyval** | `@buntime/plugin-turso` | `@buntime/plugin-keyval` | Tabela `kv_metrics` quando `metrics.persistent: true` | Contadores `operations`/`errors`/`latency_sum` |
| **estado operacional do plugin-gateway** | `@buntime/plugin-turso` quando disponível | `@buntime/plugin-gateway` | Tabelas `gateway_metrics_history` e `gateway_shell_excludes` de propriedade do plugin | Histórico de métricas e shell excludes dinâmicos. O Gateway continua funcionando sem estado durável quando o Turso está desabilitado |
| **regras do plugin-proxy** | `@buntime/plugin-turso` | `@buntime/plugin-proxy` | Tabela `proxy_rules` de propriedade do plugin | Regras dinâmicas de redirect/proxy (regras estáticas residem em `manifest.yaml`). O Proxy mantém as regras estáticas disponíveis quando o Turso está desabilitado |
| **plugin-vhosts** | `@buntime/plugin-turso` | `@buntime/plugin-vhosts` | Armazenamento de propriedade do plugin | Mapeamentos dinâmicos de host → aplicação/plugin |
| **store de chaves de API** | Turso DB (`@tursodatabase/database` / `@tursodatabase/sync`) em disco | `@buntime/runtime` | `${RUNTIME_STATE_DIR}/api-keys.db` (Helm: `/data/state/api-keys.db` em um PVC RWO por pod). `mode=local`: arquivo standalone; `mode=sync`: réplica embutida sincronizada contra um primário de servidor Turso | Chaves com hash SHA-256 + papel + permissões; faz bootstrap do admin antes de qualquer plugin estar disponível; arquivos legados JSON e `bun:sqlite` migrados de forma transparente |
| **Cache de configuração de worker** | Em memória (TTL configurável) | worker pool do `@buntime/runtime` | RAM do processo do runtime | Manifesto + configuração do worker; evita reler `app.yaml` a cada requisição |
| **Cache do resolver de worker** | Em memória (TTL configurável) | worker pool do `@buntime/runtime` | RAM do processo do runtime | Resolução do diretório da aplicação (qual `workerDir` contém `name@version`) |
| **Sistema de arquivos de aplicações (PVC)** | Sistema de arquivos | Runtime + `app install` da CLI/cpanel | `/data/apps` (Helm; `workerDirs: /data/.apps:/data/apps`) | Bundles de aplicações enviados (workers): `dist/`, `app.yaml`, assets |
| **Sistema de arquivos de plugins (PVC)** | Sistema de arquivos | Runtime + `plugin install` da CLI/cpanel | `/data/plugins` (Helm; `pluginDirs: /data/.plugins:/data/plugins`) | Plugins enviados (os built-ins somente leitura permanecem em `/data/.plugins` da imagem; uploads graváveis permanecem em `/data/plugins`) |

:::note
Plugins adicionais apoiados em armazenamento (histórico de deploy, sessões de
autenticação, políticas de autorização) estão planejados. Veja o
[roadmap](/pt/reference/roadmap/) para o status deles. Quando implementados, eles
serão donos de suas próprias tabelas através do `plugin-turso`.
:::

:::caution
Os caminhos `/data/.apps` e `/data/.plugins` (com ponto) são **somente leitura**,
embutidos na imagem Docker. `/data/apps` e `/data/plugins` (sem ponto) são **PVCs
mutáveis**. No desenvolvimento local, diretórios dentro do projeto Buntime também
são tratados como built-in; os uploads devem ir para um diretório separado fora
do projeto. Veja `charts/values.yaml`.
:::

## Detalhes operacionais

### provedor plugin-turso

`@buntime/plugin-turso` é o provedor de SQL durável: um plugin de infraestrutura
central que centraliza a configuração de conexão Turso, o ciclo de vida de sync,
a configuração de MVCC e os helpers de retry de conflito de escrita. Os
consumidores são donos de suas tabelas e fronteiras de schema:

| Consumidor | É dono de | Usa o `plugin-turso` para |
|----------|------|--------------------------|
| `plugin-keyval` | schema `kv_*` e semântica KV | Conexão SQL durável, modo local/sync, helpers de transação/retry |
| `plugin-gateway` | schema `gateway_*` para histórico de métricas e shell excludes dinâmicos | Conexão SQL durável, modo local/sync, helpers de transação/retry |
| `plugin-proxy` | schema `proxy_rules` para regras dinâmicas | Conexão SQL durável, modo local/sync, helpers de transação/retry |

A razão é a independência de ciclo de vida: os operadores devem ser capazes de
habilitar o gateway/proxy enquanto desabilitam o plugin KeyVal em ambientes
menores ou especializados. `plugin-turso` não é um plugin de funcionalidade
voltado ao usuário; é o provedor compartilhado de SQL durável. Os consumidores o
obtêm através da API padrão de compartilhamento de serviços — o provedor expõe um
serviço via `provides`, e os consumidores o recuperam com
`ctx.getPlugin<TursoService>("@buntime/plugin-turso")`.

Os modos recomendados do provedor são apenas Turso:

| Modo | Durabilidade | Caso de uso |
|------|------------|----------|
| `local` | Arquivo local durável | Testes locais e deployments de pod único |
| `sync` | Arquivo local durável mais sincronização remota | Kubernetes e qualquer deployment com múltiplos pods ou risco de reinício/realocação |
| `remote` | SQL remoto sobre HTTP | Modo opcional futuro apenas se agregar valor |

O Turso é preferido em relação ao `bun:sqlite` para o driver durável porque o
Turso Database suporta MVCC e `BEGIN CONCURRENT`, permitindo que múltiplos
escritores prossigam em paralelo com retry de conflito. Em contraste, o driver
SQLite embutido do Bun encapsula o SQLite; o WAL do SQLite é bom para muitos
leitores concorrentes mais um escritor, mas ainda serializa os escritores.

Não monte um único arquivo de banco compartilhado em múltiplos pods. As escritas
concorrentes do Turso resolvem a concorrência de escritores no nível do engine; o
Kubernetes ainda adiciona semântica de sistema de arquivos e de lock que depende
do backend de armazenamento. Para Kubernetes, cada pod deve ter seu próprio
arquivo de banco local e sincronizar através do Turso Sync.

Para Kubernetes auto-hospedado, `sync` e `remote` ambos requerem um endpoint
Turso. Esse endpoint pode ser o Turso Cloud externo ou um pod/serviço Turso
dentro do cluster.

Orientações de implementação:

- Declare `@buntime/plugin-turso` como a dependência de armazenamento para
  `plugin-keyval`, `plugin-gateway` e `plugin-proxy`.
- Mantenha os manifestos de `plugin-gateway` e `plugin-proxy` livres de
  dependências do KeyVal para seu próprio estado. Ambos os consumidores de borda
  usam o Turso diretamente.
- Mantenha as APIs de domínio dentro de cada plugin consumidor. `plugin-turso`
  expõe primitivas de banco/transação/sync, não APIs de negócio de
  proxy/gateway/keyval.
- Faça retry de conflitos de escrita do Turso em torno de transações
  `BEGIN CONCURRENT`.

### store de chaves de API

O `ApiKeyStore` **não** é um store apoiado em plugin, porque ele precisa
funcionar **antes** de qualquer plugin ser carregado — a chave raiz do runtime
autentica `worker install` / `plugin install` antes de qualquer plugin (incluindo
o plugin-turso) sequer ser carregado. Ele deve permanecer autocontido no
bootstrap.

Backend: **Turso DB** (via `@tursodatabase/database` para modo local e
`@tursodatabase/sync` para modo de réplica embutida/multi-pod). Os arquivos do
Turso DB são binariamente compatíveis com SQLite — qualquer `.db` pré-existente
(de deployments anteriores com `bun:sqlite` ou `libsql`) abre de forma
transparente.

Schema: uma única tabela `api_keys` com dois índices parciais
(`idx_api_keys_lookup` em `key_hash` e `idx_api_keys_expiry` em `expires_at`,
ambos `WHERE revoked_at IS NULL`). As permissões são codificadas em JSON.

| Aspecto | Valor |
|--------|-------|
| Backend | Turso DB (Rust, journal MVCC). Drivers: `@tursodatabase/database` (local), `@tursodatabase/sync` (réplica embutida). |
| Modos | `local` (arquivo standalone, pod único, padrão). `sync` (réplica embutida sincronizada com um primário de servidor Turso, multi-pod). |
| Hash | SHA-256 do segredo completo |
| Caminho | `${RUNTIME_STATE_DIR}/api-keys.db` (Helm: `/data/state/api-keys.db` em um PVC RWO por pod via os `volumeClaimTemplates` do StatefulSet). |
| Granularidade | Papéis `admin` / `editor` / `viewer` / `custom` (veja [o Runtime](/pt/concepts/runtime/)) |
| Chave raiz | Variável de ambiente `RUNTIME_ROOT_KEY` (Secret do Helm `buntime.rootKey`); principal sintético `root`; ignora CSRF e hooks de plugin; **não** reside no BD. |
| Multi-pod | Veja [Deployment multi-pod](/pt/ops/multi-pod/). Quando `tursoPrimary.enabled=true`, o chart provisiona um StatefulSet de primário de servidor Turso e aponta o ApiKeyStore (e opcionalmente o plugin-turso) para ele. |
| Legado | Antes de 2026-05-20 o store usava JSON, depois brevemente `bun:sqlite`. Ambos são automigrados. O JSON é renomeado para `*.migrated` (backup defensivo). |

### caches em memória do worker pool

Estes não são "stores" no sentido durável — eles desaparecem ao reiniciar. Mas
governam o comportamento em produção e são **ajustáveis** via variáveis de
ambiente:

| Cache | Variável de ambiente | Padrão | Quando desabilitar |
|-------|---------|---------|-----------------|
| Cache de configuração de worker | `RUNTIME_WORKER_CONFIG_CACHE_TTL_MS` | `1000` ms | Aplicações mutáveis em dev (defina como `0`) |
| Cache do resolver de worker | `RUNTIME_WORKER_RESOLVER_CACHE_TTL_MS` | `1000` ms | Aplicações sendo (re)instaladas em loop |
| Concorrência efêmera | `RUNTIME_EPHEMERAL_CONCURRENCY` | `2` | Não é um cache, mas afeta workers `ttl: 0` — veja [performance](/pt/ops/performance/) |
| Limite da fila efêmera | `RUNTIME_EPHEMERAL_QUEUE_LIMIT` | `100` | Requisições em excesso recebem `503` |

TTL de cache `0` = sempre reler do disco, útil em dev. Em produção, o padrão de
`1000 ms` absorve picos sem manter dados obsoletos por muito tempo.

### Sistema de arquivos em produção

| Volume | Mount | Origem | RW |
|--------|-------|--------|----|
| `/data/apps` | `workerDirs` (segundo) | PVC | RW |
| `/data/.apps` | `workerDirs` (primeiro) | Imagem Docker | RO |
| `/data/plugins` | `pluginDirs` (segundo) | PVC | RW |
| `/data/.plugins` | `pluginDirs` (primeiro) | Imagem Docker | RO |
| `/data/state/api-keys.db` | store de chaves de API (Turso DB) | PVC | RW |

:::note
Em um ambiente local sem Helm (`bun dev`), o runtime cria os stores em `./data/`
por padrão; defina `RUNTIME_STATE_DIR` para um caminho diferente para isolá-los.
:::

## Mapeamento dev → prod

Quando o mesmo código roda localmente (sem Helm) e no Rancher/k3s, os caminhos
dos stores diferem — útil para entender por que o `bun dev` vê um estado
diferente do pod.

| Conceito | Dev local (`bun dev`) | Helm (Rancher/k3s) |
|---------|-----------------------|--------------------|
| Plugins externos (RW) | `./plugins/` ou `RUNTIME_PLUGIN_DIRS` | `/data/plugins` (PVC) |
| Plugins core (RO) | Repositório (`packages/plugin-*` ou bundle) | `/data/.plugins` (imagem) |
| Aplicações (RW) | `./apps-data/` ou `RUNTIME_WORKER_DIRS` | `/data/apps` (PVC) |
| Aplicações embutidas (RO) | — | `/data/.apps` (imagem, raramente usado) |
| Store de chaves de API | `./.buntime/api-keys.db` ou `${RUNTIME_STATE_DIR}/api-keys.db` | `/data/state/api-keys.db` |
| Driver SQL | Turso Database através do `@buntime/plugin-turso` | O chart do runtime expõe `plugins.turso.*`; o Kubernetes usa Turso Sync em vez de um arquivo de BD compartilhado |

Veja `charts/values.base.yaml` (`runtime.pluginDirs`, `runtime.workerDirs`) para
a fonte canônica dos caminhos de produção. Veja
[Helm e Kubernetes](/pt/ops/helm-kubernetes/) para os PVCs.

## Backup e durabilidade

Ordem de prioridade para planejamento de DR:

1. **Estado SQL.** O SQL durável usa Turso Database via `@buntime/plugin-turso`.
   Faça backup pelo mecanismo compatível com Turso do seu deployment (snapshot do
   arquivo local ou backup do servidor de Turso Sync).
2. **`/data/state/api-keys.db`.** Sem isso, o acesso do operador é perdido. Em
   configurações multi-pod, use o modo `sync` (réplica embutida contra um primário
   de servidor Turso) em vez de compartilhar um único arquivo entre pods.
3. **`/data/apps` e `/data/plugins`.** Podem ser reconstruídos via `app install`
   / `plugin install` se um registry/artefato estiver disponível; sem um, a perda
   significa recriar do zero.
4. **Caches em memória.** Nenhum backup necessário — eles se reconstroem sob
   demanda.

## Tabelas do KeyVal

Esta seção é a **referência atual de schema** para as tabelas que
`@buntime/plugin-keyval` cria através do `@buntime/plugin-turso`. Comportamento,
API REST e semântica de operações residem em [o plugin KeyVal](/pt/plugins/keyval/) —
esta seção foca em DDL e codificação.

### Inicialização

`initSchema(adapter)` é chamado no `onInit` do plugin
(`plugins/plugin-keyval/server/lib/schema.ts`) como um único `adapter.batch([...])`,
criando seis tabelas mais índices auxiliares. Todas usam `CREATE TABLE IF NOT EXISTS`,
então reinícios são idempotentes. O adaptador é `TursoKeyValAdapter`, uma camada
de compatibilidade de propriedade do KeyVal sobre o `TursoService`.

| Tabela | Propósito | Persistente | Notas |
|-------|---------|------------|-------|
| `kv_entries` | Entradas KV (key/value/versionstamp/expires_at) | Sempre | Núcleo do store |
| `kv_queue` | Fila FIFO ativa (pending/processing) | Sempre | Travada por `locked_until` |
| `kv_dlq` | Dead-letter queue | Sempre | Sem limpeza automática |
| `kv_metrics` | Contadores agregados | Quando `metrics.persistent: true` | Flush periódico |
| `kv_indexes` | Metadados de índice de busca | Sempre que a busca estiver presente | Prefixo, lista de campos, metadados do tokenizer |
| `kv_fts_<prefix>` | Tabela de busca por prefixo | Quando `POST /api/indexes` é chamado | Tabela regular com `doc_key` e texto `document` normalizado |

### kv_entries

```sql
CREATE TABLE IF NOT EXISTS kv_entries (
  key BLOB PRIMARY KEY,
  value BLOB NOT NULL,
  versionstamp TEXT NOT NULL,
  expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_kv_expires
  ON kv_entries(expires_at)
  WHERE expires_at IS NOT NULL;
```

| Coluna | Tipo | Conteúdo |
|--------|------|----------|
| `key` | BLOB (PK) | Chave codificada em binário com prefixo de tipo, garantindo ordem lexicográfica `Uint8Array < string < number < bigint < boolean` |
| `value` | BLOB | Valor serializado (tipicamente JSON; pode ser binário) |
| `versionstamp` | TEXT | Hex monotônico — incrementa a cada `set`/`atomic`. Base para OCC |
| `expires_at` | INTEGER nullable | Unix epoch (s) quando a entrada expira; `NULL` = sem TTL |

O índice parcial `idx_kv_expires` é o que torna a limpeza de TTL eficiente sem um
full table scan.

:::caution[Edições manuais]
Tanto `key` quanto `value` são `BLOB`. Se você editar `kv_entries` diretamente via
CLI `sqlite3` ou outra ferramenta, você **deve** inserir/atualizar o valor como um
`BLOB` (`Uint8Array`), não como uma string `TEXT` — a API serializa valores JSON
em bytes, e um valor do tipo string falhará na decodificação no momento da leitura.
Prefira a API HTTP/SDK do plugin para qualquer modificação.
:::

#### Codificação de chave aninhada

Valores `KvKey` (arrays de `KvKeyPart`) são codificados em **um único BLOB** via
codificação binária com prefixos de tipo:

```
["users", "123"]              → BLOB(<str-tag>users<sep><str-tag>123)
["users", 42, "profile"]      → BLOB(<str-tag>users<sep><num-tag>42<sep><str-tag>profile)
```

Isso possibilita:

1. **PRIMARY KEY direta** — sem joins ou tabelas auxiliares.
2. **Range scans por prefixo** — `WHERE key >= prefix AND key < prefix_upper_bound`
   ordena lexicograficamente.
3. **Ordenação estável** entre tipos (números antes de strings, etc.).

A função `where-to-sql.ts` traduz filtros como
`{ "field": { "$eq": "value" } }` para SQL usando `json_extract(value, '$.field')`
— índices em nível de coluna existem apenas para `expires_at`.

### kv_queue

```sql
CREATE TABLE IF NOT EXISTS kv_queue (
  id TEXT PRIMARY KEY,
  value BLOB NOT NULL,
  ready_at INTEGER NOT NULL,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  backoff_schedule TEXT,
  keys_if_undelivered TEXT,
  status TEXT DEFAULT 'pending',
  locked_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_queue_ready
  ON kv_queue(status, ready_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_queue_locked
  ON kv_queue(locked_until) WHERE status = 'processing';
```

| Coluna | Conteúdo |
|--------|----------|
| `id` | UUIDv7 da mensagem |
| `value` | Payload (BLOB / JSON serializado) |
| `ready_at` | Quando a mensagem fica disponível (suporta `delay`) |
| `attempts` / `max_attempts` | Contagem atual e teto (move para a DLQ quando atingido) |
| `backoff_schedule` | Array JSON `[1000, 5000, 10000]` (ms) |
| `keys_if_undelivered` | Array JSON de `KvKey[]` para fallback da DLQ |
| `status` | `pending` \| `processing` |
| `locked_until` | Unix epoch (s) — quando o lock de dequeue expira |

Os dois índices parciais cobrem os caminhos quentes: dequeue (`status='pending' AND
ready_at <= now`) e limpeza de locks obsoletos (`status='processing' AND locked_until
< now`).

### kv_dlq

```sql
CREATE TABLE IF NOT EXISTS kv_dlq (
  id TEXT PRIMARY KEY,
  original_id TEXT NOT NULL,
  value BLOB NOT NULL,
  error_message TEXT,
  attempts INTEGER NOT NULL,
  original_created_at INTEGER NOT NULL,
  failed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dlq_failed_at ON kv_dlq(failed_at);
```

A DLQ é append-only. `requeue` move uma entrada de volta para `kv_queue` (com
`status='pending'`); `delete`/`purge` a remove. Limpeza automática **não** existe
— os operadores precisam de seu próprio job (veja troubleshooting em
[o plugin KeyVal](/pt/plugins/keyval/)).

### kv_metrics

```sql
CREATE TABLE IF NOT EXISTS kv_metrics (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  latency_sum REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metrics_operation ON kv_metrics(operation);
```

A tabela é sempre criada (DDL em `initSchema`), mas só populada quando
`metrics.persistent: true`. A cadência de flush é controlada por
`metrics.flushInterval` (padrão `30000` ms). Para deployments efêmeros, deixar
isto como `false` e expor métricas via `/api/metrics` ou
`/api/metrics/prometheus` (em memória) é suficiente.

### kv_indexes + tabelas de busca

```sql
CREATE TABLE IF NOT EXISTS kv_indexes (
  prefix BLOB PRIMARY KEY,
  fields TEXT NOT NULL,
  tokenize TEXT DEFAULT 'unicode61',
  created_at INTEGER NOT NULL
);
```

Cada linha em `kv_indexes` corresponde a **uma** tabela de busca regular criada
dinamicamente quando o usuário chama `POST /api/indexes`:

```sql
CREATE TABLE IF NOT EXISTS kv_fts_<hash-of-prefix> (
  doc_key TEXT PRIMARY KEY,
  document TEXT NOT NULL
);
```

A coluna `document` armazena texto normalizado extraído dos campos configurados.
A sincronização é automática para `set`/`delete`/atomic — nenhum reindex manual é
necessário, a menos que o índice seja recriado.

:::caution
O Turso Database com MVCC rejeita tabelas virtuais do SQLite, e o SDK instalado
também apresentou limitações no módulo FTS5. Não recrie `kv_fts_*` como `CREATE
VIRTUAL TABLE`; mantenha-a como uma tabela regular de propriedade do KeyVal a
menos que o suporte do Turso mude e os testes provem a migração.
:::

| Tokenizer | Implementação SQLite |
|-----------|-----------------------|
| `unicode61` | Tokenizer padrão (multilíngue) |
| `porter` | Stemming em inglês |
| `ascii` | ASCII puro |

### Antigas regras dinâmicas do plugin-proxy

`plugin-proxy` não armazena mais regras dinâmicas no KeyVal. O antigo prefixo
`["proxy", "rules"]` foi substituído pela tabela `proxy_rules` de propriedade do
proxy através do [`plugin-turso`](/pt/plugins/turso/).

As regras estáticas ainda residem em `manifest.yaml` e nunca tocam o KeyVal. As
regras dinâmicas agora recebem UUIDs gerados e estão documentadas em
[o plugin Proxy](/pt/plugins/proxy/).

## Referências cruzadas

- [plugin-turso](/pt/plugins/turso/) — Provedor Turso Database para SQL durável.
- [plugin-keyval](/pt/plugins/keyval/) — Semântica KV (versionstamps, atomic, filas, FTS).
- [O Runtime](/pt/concepts/runtime/) — endpoints `/api/keys/*`, papéis, permissões, chave raiz.
- [Performance](/pt/ops/performance/) — ajustando os caches em memória.
- [Servidor Turso](/pt/ops/turso-server/) — executando um servidor de Turso Sync dentro do cluster.
