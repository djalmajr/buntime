# Server Core

O nucleo do servidor Buntime e composto por tres modulos principais que
trabalham em conjunto para inicializar o runtime, carregar plugins e
rotear requisicoes.

## Arquitetura

```
apps/runtime/src/
├── index.ts              # Bun.serve entry point
├── api.ts                # Dependency initialization
├── app.ts                # Request resolution, CSRF
├── config.ts             # Runtime configuration
├── constants.ts          # Environment variables
├── routes/
│   ├── apps.ts           # /api/apps (app management)
│   ├── health.ts         # /api/health (health checks)
│   ├── plugins.ts        # /api/plugins (plugin management)
│   └── worker.ts         # /:app/* routes
└── utils/
    ├── request.ts        # Body cloning, size limits, URL rewriting
    ├── serve-static.ts   # Static file serving
    └── ...
```

## Fluxo de Inicializacao

```
┌─────────────┐
│ constants.ts│ Valida env vars (PORT, NODE_ENV)
└──────┬──────┘
       │
┌──────▼──────┐
│   api.ts    │ Inicializa dependencias:
│             │ 1. Logger global (RUNTIME_LOG_LEVEL)
│             │ 2. Inicializa config (RUNTIME_WORKER_DIRS, RUNTIME_POOL_SIZE)
│             │ 3. Cria WorkerPool
│             │ 4. Carrega plugins (PluginLoader)
│             │ 5. Cria rotas (apps, health, plugins, workers)
│             │ 6. Cria app (createApp)
└──────┬──────┘
       │
┌──────▼──────┐
│  index.ts   │ Inicia servidor:
│             │ 1. Bun.serve({ fetch: app.fetch })
│             │ 2. registry.runOnServerStart(server)
│             │ 3. Configura graceful shutdown
└─────────────┘
```

## Modulos

### constants.ts

Define constantes e valida variaveis de ambiente essenciais:

``` typescript
// apps/runtime/src/constants.ts
export const { DELAY_MS, NODE_ENV, PORT } = envSchema.parse(Bun.env);
export const IS_DEV = NODE_ENV === "development";
export const IS_COMPILED = typeof BUNTIME_COMPILED !== "undefined";

// Body size limits
export const BodySizeLimits = {
  DEFAULT: 10 * 1024 * 1024,  // 10MB
  MAX: 100 * 1024 * 1024,     // 100MB
} as const;

// Reserved paths (cannot be used by plugins/apps)
export const RESERVED_PATHS = ["/api", "/health", "/.well-known"];

// HTTP headers used by Buntime
export const Headers = {
  BASE: "x-base",
  INTERNAL: "x-buntime-internal",
  NOT_FOUND: "x-not-found",
  REQUEST_ID: "x-request-id",
} as const;
```

### config.ts

Carrega configuracao do runtime a partir de variaveis de ambiente:

``` typescript
// apps/runtime/src/config.ts
interface RuntimeConfig {
  bodySize: { default: number; max: number; };
  delayMs: number;
  isCompiled: boolean;
  isDev: boolean;
  nodeEnv: string;
  pluginDirs: string[];
  poolSize: number;
  port: number;
  version: string;
  workerDirs: string[];
}

export function initConfig(options?: InitConfigOptions): RuntimeConfig {
  // RUNTIME_WORKER_DIRS (obrigatorio)
  // RUNTIME_PLUGIN_DIRS (default: ./plugins)
  // RUNTIME_POOL_SIZE (default: 10/50/500 por env)
}
```

### api.ts

Inicializa todas as dependencias e cria o app Hono:

``` typescript
// apps/runtime/src/api.ts
export async function initRuntime() {
  // 1. Logger
  const logLevel = Bun.env.RUNTIME_LOG_LEVEL ||
    (NODE_ENV === "production" ? "info" : "debug");
  const logger = createLogger({ level: logLevel, format: ... });
  setLogger(logger);

  // 2. Config
  const runtimeConfig = initConfig();

  // 3. Worker Pool
  const pool = new WorkerPool({ maxSize: runtimeConfig.poolSize });

  // 4. Plugins
  const loader = new PluginLoader({ pool });
  const registry = await loader.load();

  // 5. Core Routes
  const coreRoutes = new Hono()
    .route("/apps", createAppsRoutes())
    .route("/health", createHealthRoutes())
    .route("/plugins", createPluginsRoutes({ loader, registry }));

  // 6. OpenAPI
  coreRoutes.get("/openapi.json", ...);
  coreRoutes.get("/docs", Scalar({ ... }));

  // 7. App
  const app = createApp({ coreRoutes, getWorkerDir, pool, registry, workers });

  return { app, pool, registry, ... };
}
```

### app.ts

Logica de resolucao de requests e CSRF:

``` typescript
// apps/runtime/src/app.ts
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // CSRF middleware for /api/*
  app.use("/api/*", async (c, next) => {
    const req = c.req.raw;
    const result = validateCsrf(req);
    if (!result.valid) {
      return c.text(result.error!, 403);
    }
    await next();
  });

  // Mount core routes
  app.route("/api", deps.coreRoutes);

  // Mount plugin routes
  for (const plugin of deps.registry.getAll()) {
    if (plugin.routes) {
      app.route(plugin.base, plugin.routes);
    }
  }

  // Main handler
  app.all("*", async (c) => {
    // 1. Body size validation
    // 2. Run onRequest hooks
    // 3. Try plugin server.fetch
    // 4. Try plugin routes
    // 5. Try plugin apps
    // 6. Try worker routes
    // 7. 404
  });

  return app;
}
```

### index.ts

Entry point que inicia o servidor:

``` typescript
// apps/runtime/src/index.ts
const { app, pool, registry } = await initRuntime();

const pluginRoutes = registry.collectServerRoutes();
const websocket = registry.getWebSocketHandler();

const server = Bun.serve({
  fetch: app.fetch,
  idleTimeout: 0,
  port: PORT,
  routes: pluginRoutes,
  ...(isDev && { development: { hmr: true } }),
  ...(websocket && { websocket }),
});

// Notify plugins
registry.runOnServerStart(server);

// Graceful shutdown
process.on("SIGINT", async () => {
  const forceExitTimer = setTimeout(() => process.exit(1), 30_000);
  try {
    await registry.runOnShutdown();
    pool.shutdown();
    await logger.flush();
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (err) {
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
});
```

## Request Resolution

```mermaid
flowchart TD
    A[Request] --> B{CSRF Valid?}
    B -->|No| C[403 Forbidden]
    B -->|Yes| D{/api/*?}
    D -->|Yes| E[Core Routes]
    E --> E1[/api/apps]
    E --> E2[/api/health]
    E --> E3[/api/plugins]
    E --> E4[/api/openapi.json]
    E --> E5[/api/docs]
    D -->|No| F{Plugin server.fetch?}
    F -->|Match| G[Plugin Handler]
    F -->|No| H{Plugin routes?}
    H -->|Match| I[Plugin Hono Route]
    H -->|No| J{Plugin app?}
    J -->|Match| K[Plugin App]
    J -->|No| L{Worker?}
    L -->|Match| M[Worker Pool]
    L -->|No| N[404]
```

## API Routes

| Route | Method | Descricao |
|-------|--------|-----------|
| `/api/apps` | GET | Lista apps instalados |
| `/api/apps/upload` | POST | Upload de app (tarball/zip) |
| `/api/apps/:scope/:name` | DELETE | Remove app |
| `/api/apps/:scope/:name/:version` | DELETE | Remove versao especifica |
| `/api/health` | GET | Health check principal |
| `/api/health/ready` | GET | Readiness probe |
| `/api/health/live` | GET | Liveness probe |
| `/api/plugins` | GET | Lista plugins disponiveis |
| `/api/plugins/loaded` | GET | Lista plugins carregados |
| `/api/plugins/reload` | POST | Recarrega todos os plugins |
| `/api/plugins/upload` | POST | Upload de plugin |
| `/api/plugins/:name` | DELETE | Remove plugin |
| `/api/openapi.json` | GET | OpenAPI specification |
| `/api/docs` | GET | Scalar API documentation |

## CSRF Protection

O runtime implementa protecao CSRF para rotas `/api/*`:

``` typescript
function validateCsrf(req: Request): { valid: boolean; error?: string } {
  // Skip safe methods
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return { valid: true };
  }

  // Allow internal requests
  if (req.headers.get("x-buntime-internal") === "true") {
    return { valid: true };
  }

  // Browser requests must have Origin header
  if (req.headers.get("sec-fetch-mode")) {
    const origin = req.headers.get("origin");
    if (!origin) {
      return { valid: false, error: "Origin header required" };
    }

    // Validate origin matches host
    const originUrl = new URL(origin);
    const hostUrl = new URL(req.url);
    if (originUrl.host !== hostUrl.host) {
      return { valid: false, error: "Origin mismatch" };
    }
  }

  return { valid: true };
}
```

## Graceful Shutdown

O runtime implementa shutdown gracioso com timeout de 30 segundos:

1. Recebe sinal SIGINT
2. Inicia timer de force exit (30s)
3. Executa `registry.runOnShutdown()` (plugins em ordem reversa)
4. Encerra pool de workers
5. Flush de logs
6. Exit 0

Se qualquer etapa falhar ou timeout expirar, force exit com codigo 1.
