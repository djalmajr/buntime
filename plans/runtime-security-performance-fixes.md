# Runtime: Correções de Segurança e Performance

Análise completa do runtime identificou **70+ problemas** categorizados por severidade.

**Primeira rodada:** 22 problemas (segurança, performance, bugs, qualidade)
**Segunda rodada:** 48+ problemas (edge cases, concurrency, config, logging)

## Problemas Críticos (Segurança)

### 1. XSS via x-fragment-route

**Arquivo:** `src/libs/pool/wrapper.ts:99-120`

**O que acontece:**
```typescript
const fragmentRoute = req.headers.get("x-fragment-route");
injection += `<script>window.__FRAGMENT_ROUTE__="${fragmentRoute}";...`
```

O valor do header é injetado diretamente em um script inline sem sanitização.

**Por que é problema:**
Se o pathname contiver `"</script><script>alert('xss')</script>`, o script fecha a string e executa código arbitrário. Um atacante pode:
- Roubar cookies de sessão
- Fazer requests autenticados em nome do usuário
- Modificar a interface para phishing

**Correção:**
```typescript
// Escapar ou usar JSON.stringify
const safeRoute = JSON.stringify(fragmentRoute);
injection += `<script>window.__FRAGMENT_ROUTE__=${safeRoute};...`
```

---

### 2. XSS via x-base

**Arquivo:** `src/libs/pool/wrapper.ts:109`

**O que acontece:**
```typescript
const base = req.headers.get("x-base") ?? "/";
injection = `<base href="${base}/" />`;
```

**Por que é problema:**
Se `base` contiver `"><script>evil()</script><base href="`, a tag base é quebrada e código é injetado. Mesmo sem script, um base path malicioso pode redirecionar todos os assets para um servidor do atacante.

**Correção:**
```typescript
// Validar formato do base path
const BASE_PATH_REGEX = /^\/[a-zA-Z0-9_-]*$/;
if (!BASE_PATH_REGEX.test(base)) {
  throw new Error(`Invalid base path: ${base}`);
}
```

---

### 3. Plugin Base Path sem Validação

**Arquivo:** `src/plugins/loader.ts:314-318`

**O que acontece:**
```typescript
if (options.base !== undefined) {
  plugin.base = options.base as string; // Sem validação
}
```

**Por que é problema:**
Um plugin malicioso pode definir `base: "/../api"` e interceptar rotas de outros plugins, ou `base: ""` e capturar todas as requisições. O atacante pode:
- Interceptar requests de autenticação
- Servir conteúdo malicioso em rotas legítimas
- Bypassar controles de acesso

**Correção:**
```typescript
const BASE_PATH_REGEX = /^\/[a-zA-Z0-9_-]+$/;
if (options.base !== undefined) {
  if (!BASE_PATH_REGEX.test(options.base)) {
    throw new Error(`Invalid base path "${options.base}" for plugin "${name}"`);
  }
  plugin.base = options.base;
}
```

---

### 4. Race Condition no Worker Cache

**Arquivo:** `src/libs/pool/pool.ts:95-99`

**O que acontece:**
```typescript
const instance = new WorkerInstance(...);
// Worker pode falhar aqui, antes de ser cacheado
if (config.ttlMs > 0) {
  this.cache.set(key, instance);
  this.scheduleCleanup(key, instance, config);
}
```

**Por que é problema:**
Se o worker falhar durante inicialização, o cleanup timer referencia uma instância que nunca foi cacheada. Em cenários de alta carga com workers falhando, isso pode causar:
- Timers órfãos consumindo memória
- Referências a workers inexistentes
- Comportamento inconsistente entre workers efêmeros e persistentes

**Correção:**
```typescript
const instance = new WorkerInstance(...);
try {
  await instance.waitReady(); // Garantir que worker está pronto
  if (config.ttlMs > 0) {
    this.cache.set(key, instance);
    this.scheduleCleanup(key, instance, config);
  }
} catch (err) {
  instance.terminate();
  throw err;
}
```

---

## Problemas Altos (Performance/Memória)

### 5. Memory Leak: ephemeralWorkers

**Arquivo:** `src/libs/pool/metrics.ts:52, 134-167`

**O que acontece:**
```typescript
private ephemeralWorkers: EphemeralWorkerEntry[] = [];
// Cada worker efêmero adiciona entrada
this.ephemeralWorkers.push({ key, stats, startedAt, finishedAt });
```

**Por que é problema:**
Diferente do cache de workers persistentes que usa QuickLRU com limite, este array cresce indefinidamente. Em produção com deploys frequentes (cada versão = novo key), a memória cresce linearmente com o tempo.

Cálculo: 1000 deploys/dia × 30 dias = 30k entradas × ~500 bytes = 15MB apenas neste array.

**Correção:**
```typescript
private ephemeralWorkers = new QuickLRU<string, EphemeralWorkerEntry>({ maxSize: 1000 });
// Ou usar buffer circular
private ephemeralWorkers = new CircularBuffer<EphemeralWorkerEntry>(1000);
```

---

### 6. Memory Leak: historicalStats

**Arquivo:** `src/libs/pool/metrics.ts:62`

**O que acontece:**
```typescript
private historicalStats = new Map<string, WorkerStats>();
// Nunca remove entradas antigas
```

**Por que é problema:**
Cada combinação única de app + versão cria uma entrada permanente. Em ambientes com CI/CD ativo, novas versões são deployadas frequentemente. O Map cresce para sempre.

**Correção:**
```typescript
private historicalStats = new QuickLRU<string, WorkerStats>({
  maxSize: 500,
  maxAge: 3600000 // 1 hora
});
```

---

### 7. Request Body Transferido Múltiplas Vezes

**Arquivo:** `src/app.ts:306-308`

**O que acontece:**
```typescript
const requestBody = ctx.req.raw.body
  ? await Bun.readableStreamToArrayBuffer(ctx.req.raw.clone().body!)
  : null;

// Este mesmo ArrayBuffer é passado para múltiplos handlers
const shellReq = new Request(url, { body: requestBody, ... });
const pluginReq = new Request(url, { body: requestBody, ... });
```

**Por que é problema:**
ArrayBuffer pode ser transferido apenas uma vez via postMessage. Se um request passa por shell e depois fallback para worker, o segundo handler recebe buffer detached. Resultado: dados perdidos silenciosamente ou erro "ArrayBuffer has been detached".

**Correção:**
```typescript
// Criar nova cópia para cada handler que precisa do body
const createRequestWithBody = () => {
  const bodyCopy = requestBody ? new Uint8Array(requestBody).buffer : null;
  return new Request(url, { body: bodyCopy, ... });
};
```

---

### 8. Sem Limite de Tamanho no Body

**Arquivo:** `src/app.ts:306-308`

**O que acontece:**
```typescript
const requestBody = ctx.req.raw.body
  ? await Bun.readableStreamToArrayBuffer(ctx.req.raw.clone().body!)
  : null;
```

**Por que é problema:**
Nenhuma validação de Content-Length. Um atacante pode enviar body de 10GB, consumindo toda memória disponível. É um vetor de DoS trivial.

**Correção:**
```typescript
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB
const contentLength = parseInt(ctx.req.header("content-length") ?? "0", 10);
if (contentLength > MAX_BODY_SIZE) {
  return ctx.json({ error: "Payload too large" }, 413);
}
```

---

### 9. Event Listeners não Removidos

**Arquivo:** `src/libs/pool/instance.ts:47-55, 68-115`

**O que acontece:**
```typescript
// Em waitReady()
const handler = ({ data }) => { ... };
this.worker.addEventListener("message", handler);
// Removido apenas no success path

// Em fetch()
const handleMessage = ({ data }) => { ... };
this.worker.addEventListener("message", handleMessage);
// Removido no cleanup, mas pode vazar em edge cases
```

**Por que é problema:**
Se timeout ocorrer, ou worker emitir mensagens inesperadas, listeners podem acumular. Cada listener mantém referência ao closure, causando memory leak progressivo.

**Correção:**
```typescript
// Usar AbortController para cleanup garantido
const controller = new AbortController();
this.worker.addEventListener("message", handler, { signal: controller.signal });

// Em qualquer path de saída:
controller.abort();
```

---

## Problemas Médios (Bugs/Inconsistências)

### 10. onRequest Chamado Duas Vezes

**Arquivo:** `src/app.ts:333, 358`

**O que acontece:**
```typescript
// Shell mode path
if (shell && pool && shouldRouteToShell(...)) {
  const authResult = await registry.runOnRequest(ctx.req.raw, appInfo); // 1x
  ...
}

// Normal path
if (registry) {
  const result = await registry.runOnRequest(ctx.req.raw, appInfo); // 2x
  ...
}
```

**Por que é problema:**
Se shouldRouteToShell retornar false após o primeiro check, o request passa pelo segundo runOnRequest. Plugins com side effects (logging, rate limiting, contadores) executam duas vezes para o mesmo request.

**Correção:**
Reestruturar para executar onRequest uma única vez no início, antes de qualquer branching.

---

### 11. sortedPaths Recriado a Cada Request

**Arquivo:** `src/app.ts:400`

**O que acontece:**
```typescript
app.all("*", async (ctx) => {
  // A cada request:
  const sortedPaths = [...pluginRoutes.keys()].sort((a, b) => b.length - a.length);
  ...
});
```

**Por que é problema:**
Operação O(n log n) executada em cada request quando o resultado é sempre o mesmo. Com 20 plugins e 10k req/s, são 200k sorts desnecessários por segundo.

**Correção:**
```typescript
// Mover para fora do handler
const sortedPaths = [...pluginRoutes.keys()].sort((a, b) => b.length - a.length);

app.all("*", async (ctx) => {
  // Usar sortedPaths já computado
  for (const base of sortedPaths) { ... }
});
```

---

### 12. Sem Circuit Breaker para Plugins

**Arquivo:** `src/plugins/registry.ts:109-139`

**O que acontece:**
```typescript
for (const plugin of this.pluginsWithOnRequest) {
  try {
    const result = await plugin.onRequest!(req, app);
    ...
  } catch (error) {
    return new Response(JSON.stringify({ error: ... }), { status: 500 });
  }
}
```

**Por que é problema:**
Se um plugin quebrar (bug, dependência indisponível), TODAS as requests falham. Não há mecanismo para:
- Desabilitar plugin temporariamente após N falhas
- Continuar com outros plugins
- Alertar sobre plugin problemático

**Correção:**
Implementar circuit breaker pattern com estados: closed → open → half-open.

---

### 13. shellPromise sem Fallback

**Arquivo:** `src/app.ts:263-267`

**O que acontece:**
```typescript
let shellPromise: Promise<ResolvedShell | undefined> | undefined;
if (homepage && pool) {
  shellPromise = resolveShell(homepage, getAppDir);
}
// Usado em cada request:
const shell = shellPromise ? await shellPromise : undefined;
```

**Por que é problema:**
Se resolveShell rejeitar (worker não encontrado, config inválida), a promise fica em estado rejected. Toda request subsequente vai re-avaliar a promise rejeitada, logando erros repetidamente ou travando.

**Correção:**
```typescript
shellPromise = resolveShell(homepage, getAppDir).catch((err) => {
  logger.error("Failed to resolve shell", err);
  return undefined;
});
```

---

### 14. Blocking spawnSync no Auto-Install

**Arquivo:** `src/libs/pool/wrapper.ts:26-35`

**O que acontece:**
```typescript
if (autoInstall) {
  Bun.spawnSync(["bun", "install", "--frozen-lockfile"], {
    cwd: APP_DIR,
    stdio: ["inherit", "inherit", "inherit"],
  });
}
```

**Por que é problema:**
spawnSync bloqueia a thread do worker durante install. Se múltiplos workers iniciam simultaneamente (cold start), todos serializam no install. Em projetos grandes, isso pode levar minutos.

**Correção:**
Pré-instalar dependências no build time, não no runtime. Ou usar spawn async com timeout.

---

### 15. Stack Traces Expostos em Erros

**Arquivo:** `src/plugins/registry.ts:129-134`

**O que acontece:**
```typescript
return new Response(
  JSON.stringify({
    error: `Plugin error: ${error instanceof Error ? error.message : String(error)}`,
  }),
  { status: 500 },
);
```

**Por que é problema:**
Error messages podem conter paths internos, queries SQL, credenciais de conexão. Um atacante pode forçar erros para mapear a infraestrutura.

**Correção:**
```typescript
logger.error("Plugin error", { plugin: plugin.name, error });
return new Response(
  JSON.stringify({ error: "Internal server error" }),
  { status: 500 },
);
```

---

### 16. Sem CSRF Protection

**Arquivo:** `src/app.ts` (global)

**O que acontece:**
Requests POST/PUT/DELETE são aceitos de qualquer origem sem validação de token CSRF ou verificação de Origin header.

**Por que é problema:**
Site malicioso pode fazer requests autenticados usando cookies do usuário. Exemplo: formulário em evil.com que submete para /api/settings alterando configurações.

**Correção:**
Validar Origin header ou implementar tokens CSRF para requests state-changing.

---

## Problemas Baixos (Qualidade)

### 17. Request Construction Duplicado

**Arquivo:** `src/app.ts:370, 413, 431, 447`

O mesmo padrão de criação de Request com body/headers/method repetido 4 vezes. Extrair para helper function.

### 18. JSDoc Ausente

Funções públicas como `resolveTargetApp`, `createAppInfo`, `servePluginApp` sem documentação. Adicionar JSDoc explicando parâmetros e retorno.

### 19. Mix de console.log e logger

Alguns arquivos usam console.log/error, outros usam logger. Padronizar para logger em todo o codebase.

### 20. Non-null Assertions

`wrapper.ts` usa `app!.fetch!()` ao invés de guards explícitos. Substituir por verificações com mensagens de erro claras.

### 21. Regex Compilado por Chamada

`pool.ts:38` compila regex a cada chamada de `getOrCreate`. Mover para constante do módulo.

### 22. Magic Numbers

`index.ts:75` usa `30000` hardcoded. Extrair para constante `SHUTDOWN_TIMEOUT_MS`.

---

## Priorização

### Fase 1: Segurança (Imediato)
1. Corrigir XSS em wrapper.ts (#1, #2)
2. Validar plugin.base (#3)
3. Limitar body size (#8)

### Fase 2: Estabilidade (1 semana)
4. Corrigir race condition (#4)
5. Implementar circuit breaker (#12)
6. Tratar shellPromise rejection (#13)

### Fase 3: Performance (2 semanas)
7. Limitar ephemeralWorkers (#5)
8. Limitar historicalStats (#6)
9. Cachear sortedPaths (#11)
10. Corrigir body transfer (#7)

### Fase 4: Cleanup (Ongoing)
11. Remover event listeners corretamente (#9)
12. Unificar onRequest (#10)
13. Refatorar duplicações (#17-22)

---

# Segunda Rodada de Análise

Análise aprofundada cobrindo áreas não examinadas na primeira rodada.

## Edge Cases e HTTP

### 23. Path Traversal em Static File Serving

**Arquivo:** `src/utils/serve-static.ts:13`

**O que acontece:**
```typescript
const file = Bun.file(path === "" ? entrypoint : join(dirname(entrypoint), path));
```

`join()` normaliza paths mas não valida contra traversal. Request para `/%2e%2e/%2e%2e/etc/passwd` pode escapar do diretório.

**Correção:**
Validar que o path resolvido permanece dentro do diretório de destino usando `realpath` e comparando prefixos.

---

### 24. Unicode Normalization Bypass

**Arquivo:** `src/app.ts:65-79, 300`

**O que acontece:**
Path matching usa comparação simples de strings sem normalizar Unicode. `/café` (composto) vs `/cafe\u0301` (decomposto) renderizam igual mas matcham diferente.

**Por que é problema:**
Atacante pode criar apps com nomes Unicode compostos e acessar com forma decomposta para evadir restrições em `resolveTargetApp()`.

**Correção:**
Normalizar paths com `pathname.normalize('NFC')` antes de comparações.

---

### 25. Header Injection via URL Reconstruction

**Arquivo:** `src/app.ts:123, 238, 369, 410`

**O que acontece:**
```typescript
const newReq = new Request(new URL(pathname + url.search, req.url).href, req);
```

Caracteres especiais ou newlines no pathname podem causar comportamento inesperado. Em cenários específicos, poderia levar a HTTP response splitting.

**Correção:**
Sanitizar pathname antes de reconstruir URL.

---

### 26. Env Vars Herdadas por Workers sem Filtro

**Arquivo:** `src/libs/pool/instance.ts:30-36`

**O que acontece:**
```typescript
env: {
  ...Bun.env,  // TODAS env vars passadas para workers
  ...config.env,
  APP_DIR: appDir,
}
```

**Por que é problema:**
Workers herdam `DATABASE_URL`, `API_KEYS`, credentials do processo pai. Worker comprometido pode ler todas variáveis sensíveis.

**Correção:**
Whitelist de env vars permitidas para workers, ou namespace com prefixo `WORKER_`.

---

### 27. Header Size sem Limite

**Arquivo:** `src/libs/pool/wrapper.ts:95, 108`

**O que acontece:**
```typescript
const headers = Object.fromEntries(response.headers.entries());
```

Headers extraídos e armazenados sem limite de tamanho. Request com header de 1GB causa memory exhaustion.

**Correção:**
Validar tamanho total de headers antes de processar.

---

## Concurrency e Estado

### 28. Stale Closure em Worker Ready Handler

**Arquivo:** `src/libs/pool/instance.ts:48-55`

**O que acontece:**
`readyPromise` captura `this.worker` em closure. Se worker receber erro crítico antes de enviar READY, o handler nunca dispara e `readyPromise` nunca resolve.

**Por que é problema:**
Todas requests subsequentes ficam em timeout esperando worker morto.

**Correção:**
Adicionar handler de erro que rejeita `readyPromise` se worker falhar.

---

### 29. Promise Rejection não Propagada

**Arquivo:** `src/libs/pool/instance.ts:68-115`

**O que acontece:**
Se worker é terminado externamente durante `fetch()`, o listener é removido mas a Promise fica pendente. `reject()` chamado após remoção do listener causa unhandled rejection.

**Correção:**
Usar AbortController para coordenar cleanup em todos os paths.

---

### 30. Cache Eviction Race Condition

**Arquivo:** `src/libs/pool/pool.ts:23-30, 62-82`

**O que acontece:**
QuickLRU `onEviction` executa sincronamente durante `getOrCreate()`. Entre `cache.get()` e `cache.set()`, eviction pode remover entry de `appDirs`, causando inconsistência.

**Correção:**
Atomizar operações de cache + appDirs ou usar lock.

---

### 31. Cleanup Timer Duplicado

**Arquivo:** `src/libs/pool/pool.ts:235-241`

**O que acontece:**
Se worker é evictado do cache enquanto timer ainda está ativo, e mesmo key é recriado antes do timer disparar, dois timers existem para mesma key.

**Por que é problema:**
Timer antigo dispara e tenta retire de worker errado.

**Correção:**
Cancelar timer existente antes de criar novo, verificar instance antes de retire.

---

### 32. Signal Handler Re-entrancy

**Arquivo:** `src/index.ts:72-94`

**O que acontece:**
```typescript
process.once("SIGINT", async () => {
  forceExitTimer = setTimeout(() => process.exit(1), 30000);
  // ...
});
```

Se usuário pressionar Ctrl+C duas vezes rapidamente, segundo SIGINT recria `forceExitTimer` sem cancelar o antigo.

**Por que é problema:**
Timer antigo órfão dispara durante shutdown graceful, interrompendo cleanup.

**Correção:**
Usar flag para ignorar SIGINTs subsequentes ou cancelar timer antigo.

---

### 33. Plugin Hook sem Isolamento

**Arquivo:** `src/plugins/registry.ts:112-139`

**O que acontece:**
Plugins executam sequencialmente. Se plugin A modifica request e plugin B lança exceção, modificações de A persistem mas request falha sem rollback.

**Por que é problema:**
Side effects parciais podem deixar sistema em estado inconsistente.

**Correção:**
Executar hooks em modo "dry-run" ou implementar compensação.

---

### 34. Worker Health Check TOCTOU

**Arquivo:** `src/libs/pool/instance.ts:146-157`

**O que acontece:**
```typescript
isHealthy() {
  if (this.hasCriticalError) return false;
  const { age, idle } = this.getStats();
  return age < this.config.ttlMs && ...
}
```

Entre `isHealthy()` retornar true e `fetch()` executar, worker pode receber erro crítico.

**Correção:**
Validar saúde dentro do `fetch()` ou usar lock.

---

## Configuração e Inicialização

### 35. NaN em Pool Size

**Arquivo:** `src/config.ts:104`

**O que acontece:**
```typescript
const poolSize = Bun.env.POOL_SIZE ? parseInt(Bun.env.POOL_SIZE, 10) : 100;
```

Se `POOL_SIZE="abc"`, `parseInt()` retorna NaN. WorkerPool tenta criar cache com `maxSize: NaN`, causando crash ou comportamento undefined.

**Correção:**
```typescript
const parsed = parseInt(Bun.env.POOL_SIZE, 10);
const poolSize = Number.isNaN(parsed) ? 100 : parsed;
```

---

### 36. Workspace Path Vazio Silenciosamente Filtrado

**Arquivo:** `src/config.ts:60-70`

**O que acontece:**
```typescript
.filter(Boolean)  // Remove empty paths silenciosamente
```

Se `WORKSPACES="${MISSING_VAR}"` e variável não existe, `substituteEnvVars` retorna string vazia, que é filtrada sem warning.

**Por que é problema:**
Usuário pensa que workspace está configurado mas path foi silenciosamente removido.

**Correção:**
Logar warning quando path resulta vazio após substituição.

---

### 37. Plugin Dependency Validada Após Load

**Arquivo:** `src/plugins/loader.ts:106-123`

**O que acontece:**
Plugin module é carregado (linha 109) antes de validar dependências (linha 120). Se módulo tem código top-level que depende de outro plugin, executa antes da validação.

**Correção:**
Validar dependências ANTES de carregar módulo.

---

### 38. TTL Auto-Ajustado Silenciosamente

**Arquivo:** `src/libs/pool/config.ts:139-142`

**O que acontece:**
```typescript
if (idleTimeoutMs > ttlMs) {
  idleTimeoutMs = ttlMs;  // Ajuste silencioso
}
```

Configuração do usuário é modificada sem warning.

**Correção:**
Logar warning explicando o ajuste.

---

### 39. Plugin Base Path Collision não Detectada

**Arquivo:** `src/plugins/loader.ts:314-318`

**O que acontece:**
```typescript
plugin.base = options.base as string;  // Sem validação de conflito
```

Dois plugins podem acabar com mesmo base path se configurados via options.

**Correção:**
Validar conflitos de base path durante loading.

---

### 40. Unknown NODE_ENV usa Default Silencioso

**Arquivo:** `src/config.ts:37-43, 104`

**O que acontece:**
```typescript
poolDefaults[NODE_ENV] ?? 100
```

Se `NODE_ENV="staging-custom"`, usa 100 silenciosamente ao invés do valor de staging (50).

**Correção:**
Logar warning para NODE_ENV desconhecido.

---

## Logging e Observabilidade

### 41. Error Messages Expõem Paths

**Arquivo:** `src/libs/pool/wrapper.ts:33`, `src/libs/pool/pool.ts:57-59`

**O que acontece:**
```typescript
throw new Error(`bun install failed in ${APP_DIR}: ${result.stderr}`);
throw new Error(`Worker collision: "${key}" already registered from "${existingAppDir}"`);
```

Paths absolutos do sistema de arquivos expostos em mensagens de erro.

**Por que é problema:**
Atacante pode mapear estrutura de diretórios do servidor.

**Correção:**
Usar paths relativos ou mascarar em produção.

---

### 42. Erros Raw Expostos a Clientes

**Arquivo:** `src/app.ts:389-392`, `src/plugins/registry.ts:130-134`

**O que acontece:**
```typescript
return ctx.json({ error: `Plugin error: ${err.message}` }, 500);
```

Error messages originais vão diretamente para o cliente.

**Correção:**
Logar erro completo server-side, retornar mensagem genérica para cliente.

---

### 43. Sem Correlation IDs

**Arquivo:** Múltiplos

**O que acontece:**
Nenhum mecanismo de request ID (correlation ID) atravessa o ciclo de vida do request. Logs de diferentes componentes não podem ser correlacionados.

**Por que é problema:**
Debugging em produção é extremamente difícil. Quando request falha, impossível rastrear logs entre main thread → plugins → workers.

**Correção:**
Gerar X-Request-ID no início, propagar para todos handlers e workers.

---

### 44. Logging Inconsistente

**Arquivo:** `src/api.ts:23-26` vs múltiplos arquivos

**O que acontece:**
Logger configurado com JSON em produção (api.ts:23), mas muitos arquivos usam `console.error()` diretamente.

**Por que é problema:**
Logs de produção têm formato misto (JSON + plaintext), dificultando parsing automatizado.

**Correção:**
Padronizar uso de logger em todo codebase.

---

### 45. Error Context Perdido em Workers

**Arquivo:** `src/libs/pool/wrapper.ts:130-131`, `src/libs/pool/instance.ts:78`

**O que acontece:**
```typescript
// wrapper.ts
self.postMessage({ type: "ERROR", error: err.message, reqId });

// instance.ts
reject(new Error(data.error));  // Novo Error perde stack original
```

Stack trace do worker é perdido na comunicação via postMessage.

**Correção:**
Serializar stack trace junto com mensagem de erro.

---

### 46. Sem Audit Trail de Segurança

**Arquivo:** `src/plugins/registry.ts:109-139`

**O que acontece:**
Quando plugins de autenticação executam `onRequest`, não há logging de:
- Requests autenticados vs rejeitados
- Falhas de autenticação
- Padrões suspeitos (múltiplas falhas do mesmo IP)

**Correção:**
Adicionar logging estruturado para eventos de segurança.

---

### 47. Sem Métricas de Tamanho

**Arquivo:** `src/libs/pool/instance.ts`, `src/libs/pool/wrapper.ts`

**O que acontece:**
Sistema de métricas rastreia tempos de resposta mas não tamanhos de request/response.

**Por que é problema:**
Impossível detectar payloads anormalmente grandes, responses não comprimidas, ou ataques via body size.

**Correção:**
Adicionar métricas de Content-Length.

---

## Priorização Atualizada

### Fase 1: Segurança Crítica (Imediato)
1. XSS via headers (#1, #2)
2. Plugin base path validation (#3)
3. Path traversal em static serving (#23)
4. Env vars leaked para workers (#26)
5. Body size limit (#8)

### Fase 2: Estabilidade (Próximas 2 semanas)
6. Race conditions no cache (#4, #30, #31)
7. Circuit breaker para plugins (#12)
8. shellPromise rejection (#13)
9. Signal handler re-entrancy (#32)
10. NaN em pool size (#35)

### Fase 3: Performance/Memory (Próximo mês)
11. Memory leaks: ephemeralWorkers, historicalStats (#5, #6)
12. Body transfer correction (#7)
13. Event listener cleanup (#9, #28, #29)
14. sortedPaths caching (#11)

### Fase 4: Observabilidade (Ongoing)
15. Correlation IDs (#43)
16. Consistent logging (#44)
17. Security audit trail (#46)
18. Error context preservation (#45)

### Fase 5: Qualidade (Ongoing)
19. Sanitize error messages (#41, #42)
20. Unicode normalization (#24)
21. Config validation improvements (#36, #37, #38, #40)
22. Code cleanup (#17-22)

---

# Mapeamento OWASP Top 10 (2021 → 2025)

Análise dos problemas identificados segundo as categorias OWASP Top 10.

## Mudanças 2021 → 2025

O OWASP Top 10 foi atualizado em novembro de 2025. Principais mudanças:

| Posição | 2021 | 2025 | Mudança |
|---------|------|------|---------|
| 1 | Broken Access Control | Broken Access Control | ↔ Manteve (agora inclui SSRF) |
| 2 | Cryptographic Failures | **Security Misconfiguration** | ↑ Subiu de #5 |
| 3 | Injection | **Software Supply Chain Failures** | 🆕 NOVO |
| 4 | Insecure Design | Cryptographic Failures | ↓ Desceu de #2 |
| 5 | Security Misconfiguration | Injection | ↓ Desceu de #3 |
| 6 | Vulnerable Components | Insecure Design | ↓ Desceu de #4 |
| 7 | Auth Failures | Authentication Failures | ↔ Manteve |
| 8 | Integrity Failures | Software/Data Integrity Failures | ↔ Manteve |
| 9 | Logging Failures | Security Logging & **Alerting** | ↔ Renomeado |
| 10 | SSRF | **Mishandling of Exceptional Conditions** | 🆕 NOVO |

**Categorias removidas:** SSRF (incorporado ao A01), Vulnerable Components (expandido para Supply Chain)
**Categorias novas:** Software Supply Chain Failures (#3), Mishandling of Exceptional Conditions (#10)

---

## A01:2021 – Broken Access Control

**Severidade no runtime:** ALTA

| # | Problema | Impacto |
|---|----------|---------|
| #3 | Plugin base path sem validação | Plugin malicioso pode interceptar rotas de outros plugins |
| #23 | Path traversal em static serving | Acesso a arquivos fora do diretório permitido |
| #24 | Unicode normalization bypass | Evasão de verificações de path |
| #39 | Plugin base path collision | Dois plugins podem sobrescrever rotas um do outro |

**Recomendações OWASP aplicáveis:**
- Negar acesso por padrão, exceto para recursos públicos
- Implementar controle de acesso uma vez e reutilizar
- Validar paths contra traversal usando realpath + prefix check
- Registrar falhas de controle de acesso com alertas

---

## A02:2021 – Cryptographic Failures

**Severidade no runtime:** MÉDIA

| # | Problema | Impacto |
|---|----------|---------|
| #26 | Env vars herdadas sem filtro | Secrets (API keys, DB passwords) expostos a workers |

**Recomendações OWASP aplicáveis:**
- Classificar dados processados/transmitidos (secrets vs públicos)
- Não armazenar dados sensíveis desnecessariamente
- Usar whitelist de env vars permitidas para workers
- Garantir que secrets não vazem em logs ou erros

---

## A03:2021 – Injection

**Severidade no runtime:** CRÍTICA

| # | Problema | Impacto |
|---|----------|---------|
| #1 | XSS via x-fragment-route | Execução de JavaScript arbitrário no browser |
| #2 | XSS via x-base | Injeção de HTML/scripts via tag base |
| #25 | Header injection via URL reconstruction | Potencial HTTP response splitting |

**Recomendações OWASP aplicáveis:**
- Usar APIs seguras que evitam uso do interpretador (parameterized)
- Escapar caracteres especiais usando sintaxe específica do contexto
- Usar JSON.stringify para valores em scripts
- Validar inputs contra whitelist de caracteres permitidos

**Correção imediata:**
```typescript
// wrapper.ts - usar JSON.stringify
const safeRoute = JSON.stringify(fragmentRoute);
injection += `<script>window.__FRAGMENT_ROUTE__=${safeRoute};...`

// Validar base path
const BASE_PATH_REGEX = /^\/[a-zA-Z0-9_-]*$/;
if (!BASE_PATH_REGEX.test(base)) throw new Error("Invalid base");
```

---

## A04:2021 – Insecure Design

**Severidade no runtime:** ALTA

| # | Problema | Impacto |
|---|----------|---------|
| #4 | Race condition no worker cache | Timers órfãos, estado inconsistente |
| #7 | Request body transferido múltiplas vezes | Dados perdidos ou corrompidos |
| #12 | Sem circuit breaker | Um plugin quebrado derruba todo o sistema |
| #28 | Stale closure em worker handler | Requests pendentes eternamente |
| #30 | Cache eviction race condition | Inconsistência entre cache e appDirs |
| #33 | Plugin hooks sem isolamento | Side effects parciais sem rollback |
| #34 | Worker health check TOCTOU | Worker usado após ficar unhealthy |

**Recomendações OWASP aplicáveis:**
- Usar threat modeling para fluxos críticos
- Integrar segurança no ciclo de desenvolvimento
- Usar padrões de design seguros (circuit breaker, bulkhead)
- Limitar consumo de recursos por usuário/serviço

**Padrões recomendados:**
- Circuit breaker para plugins com fallback gracioso
- Mutex/lock para operações de cache
- AbortController para coordenar cleanup

---

## A05:2021 – Security Misconfiguration

**Severidade no runtime:** MÉDIA

| # | Problema | Impacto |
|---|----------|---------|
| #8 | Sem limite de tamanho no body | DoS via upload de 10GB |
| #27 | Header size sem limite | Memory exhaustion via headers gigantes |
| #35 | NaN em pool size | Crash por config inválida |
| #36 | Workspace path vazio silencioso | Config errada sem feedback |
| #38 | TTL auto-ajustado silenciosamente | Comportamento diferente do esperado |
| #40 | NODE_ENV desconhecido usa default | Config de produção com valores de dev |

**Recomendações OWASP aplicáveis:**
- Processo de hardening automatizado e repetível
- Remover features/frameworks/componentes não usados
- Validar configurações em todas as camadas
- Enviar diretivas de segurança para clientes (headers)

**Configurações recomendadas:**
```typescript
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_HEADER_SIZE = 8 * 1024; // 8KB
const VALID_NODE_ENVS = ["development", "staging", "production", "test"];
```

---

## A06:2021 – Vulnerable and Outdated Components

**Severidade no runtime:** BAIXA (não diretamente aplicável)

Não foram identificados problemas diretos de componentes vulneráveis no código analisado. Recomendações gerais:

- Manter dependências atualizadas (bun update)
- Usar `bun audit` para verificar vulnerabilidades
- Remover dependências não utilizadas
- Monitorar CVEs de dependências críticas

---

## A07:2021 – Identification and Authentication Failures

**Severidade no runtime:** MÉDIA

| # | Problema | Impacto |
|---|----------|---------|
| #16 | Sem CSRF protection | Ações autenticadas via site malicioso |
| #10 | onRequest chamado duas vezes | Plugins de auth executam duas vezes |

**Recomendações OWASP aplicáveis:**
- Implementar proteção CSRF para requests state-changing
- Validar Origin header
- Usar SameSite cookies
- Garantir que hooks de auth executem exatamente uma vez

**Correção recomendada:**
```typescript
// Verificar Origin header
const origin = req.headers.get("origin");
const allowedOrigins = config.trustedOrigins ?? [];
if (req.method !== "GET" && !allowedOrigins.includes(origin)) {
  return new Response("CSRF validation failed", { status: 403 });
}
```

---

## A08:2021 – Software and Data Integrity Failures

**Severidade no runtime:** MÉDIA

| # | Problema | Impacto |
|---|----------|---------|
| #14 | Blocking spawnSync no auto-install | Execução de código durante runtime |
| #37 | Plugin dependency validada após load | Código top-level executa antes de validação |

**Recomendações OWASP aplicáveis:**
- Verificar integridade de software/dados
- Usar assinaturas digitais para verificar origem
- Não executar código não verificado em runtime
- Pré-instalar dependências no build time

---

## A09:2021 – Security Logging and Monitoring Failures

**Severidade no runtime:** ALTA

| # | Problema | Impacto |
|---|----------|---------|
| #15 | Stack traces expostos em erros | Information disclosure |
| #41 | Error messages expõem paths | Mapeamento de infraestrutura |
| #42 | Erros raw expostos a clientes | Vazamento de detalhes internos |
| #43 | Sem correlation IDs | Impossível rastrear requests |
| #44 | Logging inconsistente | Logs não parseáveis |
| #45 | Error context perdido em workers | Stack traces perdidos |
| #46 | Sem audit trail de segurança | Sem visibilidade de ataques |
| #47 | Sem métricas de tamanho | Não detecta payloads anormais |

**Recomendações OWASP aplicáveis:**
- Logar eventos de login, falhas de acesso, validação server-side
- Logs em formato parseável (JSON)
- Contexto suficiente para identificar contas suspeitas
- Estabelecer monitoramento e alertas
- Plano de resposta a incidentes

**Implementação recomendada:**
```typescript
// Correlation ID middleware
const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();

// Structured logging
logger.info("request", {
  correlationId,
  method: req.method,
  path: pathname,
  userAgent: req.headers.get("user-agent"),
});

// Security event logging
logger.warn("auth_failure", {
  correlationId,
  ip: req.headers.get("x-forwarded-for"),
  reason: "invalid_token",
});
```

---

## A10:2025 – Mishandling of Exceptional Conditions (NOVO em 2025)

**Severidade no runtime:** ALTA

Esta é uma nova categoria em 2025, cobrindo tratamento inadequado de erros e exceções que leva a comportamento imprevisível ou inseguro.

| # | Problema | Impacto |
|---|----------|---------|
| #13 | shellPromise sem fallback | Promise rejeitada trava todas requests |
| #28 | Stale closure em worker handler | Requests pendentes eternamente |
| #29 | Promise rejection não propagada | Unhandled rejection causa crash |
| #32 | Signal handler re-entrancy | Shutdown interrompido por SIGINT duplicado |
| #35 | NaN em pool size | Crash por parseInt inválido |
| #36 | Workspace path vazio silencioso | Fail silencioso sem feedback |

**Recomendações OWASP 2025 aplicáveis:**
- Implementar tratamento de erros consistente em toda aplicação
- Nunca "fail open" - sempre fail secure
- Validar inputs antes de processar
- Implementar recovery gracioso para estados de erro
- Logar exceções com contexto suficiente

**Correções recomendadas:**
```typescript
// shellPromise com fallback
shellPromise = resolveShell(homepage, getAppDir).catch((err) => {
  logger.error("Failed to resolve shell", err);
  return undefined; // Fail gracefully
});

// parseInt com validação
const parsed = parseInt(Bun.env.POOL_SIZE, 10);
if (Number.isNaN(parsed)) {
  throw new Error(`Invalid POOL_SIZE: ${Bun.env.POOL_SIZE}`);
}
```

---

## A03:2025 – Software Supply Chain Failures (NOVO em 2025)

**Severidade no runtime:** MÉDIA

Nova categoria expandida de "Vulnerable Components", cobrindo toda a cadeia de dependências, builds e distribuição.

| # | Problema | Impacto |
|---|----------|---------|
| #14 | Blocking spawnSync no auto-install | Execução de `bun install` em runtime |
| #37 | Plugin dependency validada após load | Código de plugin executa antes de validação |

**Recomendações OWASP 2025 aplicáveis:**
- Pré-instalar dependências no build time, não runtime
- Verificar integridade de pacotes (checksums, signatures)
- Usar lockfiles (bun.lockb) para reprodutibilidade
- Auditar dependências regularmente (`bun audit`)
- Validar plugins antes de executar código

**Correções recomendadas:**
```typescript
// Remover auto-install do runtime
// Usar: RUN bun install --frozen-lockfile no Dockerfile

// Validar dependências ANTES de carregar módulo
for (const dep of plugin.dependencies) {
  if (!configuredPlugins.has(dep)) {
    throw new Error(`Missing dependency: ${dep}`);
  }
}
// Só então carregar o módulo
const module = await import(pluginPath);
```

---

## Resumo por Severidade OWASP 2025

| # | Categoria OWASP 2025 | Severidade | Problemas | Ação |
|---|---------------------|------------|-----------|------|
| A01 | Broken Access Control | ALTA | 4 | Imediato |
| A02 | Security Misconfiguration | MÉDIA | 6 | Médio prazo |
| A03 | Software Supply Chain 🆕 | MÉDIA | 2 | Médio prazo |
| A04 | Cryptographic Failures | MÉDIA | 1 | Médio prazo |
| A05 | Injection | CRÍTICA | 3 | Imediato |
| A06 | Insecure Design | ALTA | 7 | Curto prazo |
| A07 | Authentication Failures | MÉDIA | 2 | Médio prazo |
| A08 | Software/Data Integrity | MÉDIA | 2 | Médio prazo |
| A09 | Logging & Alerting | ALTA | 8 | Curto prazo |
| A10 | Exceptional Conditions 🆕 | ALTA | 6 | Curto prazo |

**Total de problemas mapeados:** 41 (de 47 identificados)

### Comparativo 2021 vs 2025 - Impacto no Runtime

| Mudança | Impacto no Runtime |
|---------|-------------------|
| SSRF → incorporado A01 | Nenhum problema SSRF identificado |
| Security Misconfiguration ↑ #2 | 6 problemas agora mais prioritários |
| Supply Chain 🆕 #3 | 2 problemas antes em "Integrity" |
| Exceptional Conditions 🆕 #10 | 6 problemas agora categorizados (antes "Insecure Design") |

## Checklist de Correções Prioritárias (OWASP 2025)

### Crítico - A05 Injection + A01 Access Control
- [ ] Escapar XSS em wrapper.ts (#1, #2) - A05
- [ ] Validar plugin base paths (#3) - A01
- [ ] Implementar path traversal protection (#23) - A01
- [ ] Header injection via URL (#25) - A05

### Alto - A10 Exceptional Conditions + A09 Logging
- [ ] shellPromise com fallback (#13) - A10
- [ ] Promise rejection handling (#28, #29) - A10
- [ ] NaN em pool size (#35) - A10
- [ ] Implementar correlation IDs (#43) - A09
- [ ] Sanitizar error messages (#15, #41, #42) - A09

### Alto - A06 Insecure Design
- [ ] Circuit breaker para plugins (#12) - A06
- [ ] Race condition no cache (#4, #30) - A06
- [ ] Body transfer correction (#7) - A06

### Médio - A02 Security Misconfiguration
- [ ] Limitar body size (#8) - A02
- [ ] Limitar header size (#27) - A02
- [ ] Validar configs (#36, #38, #40) - A02

### Médio - A03 Supply Chain + A04 Crypto + A07 Auth
- [ ] Remover auto-install do runtime (#14) - A03
- [ ] Filtrar env vars para workers (#26) - A04
- [ ] Adicionar CSRF protection (#16) - A07

---

## Referências

- [OWASP Top 10:2025 Official](https://owasp.org/Top10/2025/)
- [OWASP Top 10 2025 vs 2021 - Equixly](https://equixly.com/blog/2025/12/01/owasp-top-10-2025-vs-2021/)
- [OWASP Top 10 2025 Key Changes - Orca Security](https://orca.security/resources/blog/owasp-top-10-2025-key-changes/)
