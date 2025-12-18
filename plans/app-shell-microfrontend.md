# App Shell para Microfrontends

**Status: PLANEJADO**

## Objetivo

Permitir que um plugin se declare como app shell, gerenciando todos os fragments de forma centralizada. O shell intercepta apenas o base path exato de cada microfrontend enquanto APIs e assets vão direto ao worker/proxy.

## Contexto

Atualmente, `homepage` é apenas um redirect:
```jsonc
{ "homepage": "/cpanel" }  // GET / → 302 /cpanel
```

Queremos que o próprio plugin decida se ele é um shell ou não. Se for shell, ele recebe todas as requisições de navegação na raiz `/` e decide internamente qual fragment carregar.

## Arquitetura Proposta

### Configuração

A configuração do buntime permanece simples - apenas indica qual é o homepage:

```jsonc
// buntime.jsonc
{ "homepage": "@buntime/plugin-cpanel" }

// ou worker avulso (sempre redirect)
{ "homepage": "/my-app" }
```

### Declaração no Plugin

O plugin declara se é um shell:

```typescript
// plugin-cpanel/plugin.ts
export default function cpanelPlugin(): BuntimePlugin {
  return {
    name: "@buntime/plugin-cpanel",
    base: "/cpanel",
    shell: true,  // NOVO: "eu sou um app-shell"
    // ...
  };
}
```

### Comportamento por Tipo

| homepage | plugin.shell | Comportamento |
|----------|--------------|---------------|
| `"/my-app"` (worker) | N/A | Redirect: `GET /` → 302 `/my-app` |
| `"@buntime/plugin-x"` | `false` ou undefined | Redirect: `GET /` → 302 `/plugin-x` |
| `"@buntime/plugin-cpanel"` | `true` | App Shell: cpanel serve em `/` |

### Regra de Roteamento (quando shell: true)

O shell só intercepta o **base path exato** de cada plugin:

```
GET /               → Shell (homepage)
GET /metrics        → Shell (carrega fragment metrics)
GET /metrics/       → Shell (carrega fragment metrics)
GET /metrics/*      → Worker direto (qualquer subrota)
```

### Fluxo Visual

```
Request: GET /metrics
         │
         ▼
┌─────────────────────────┐
│ homepage plugin tem     │
│ shell: true?            │
└───────────┬─────────────┘
            │
       YES  │  NO
            │   └──→ Redirect (comportamento atual)
            ▼
┌─────────────────────────┐
│ pathname === pluginBase │
│ ou pathname === "/"     │
└───────────┬─────────────┘
            │
       YES  │  NO
            │   └──→ Worker direto
            ▼
┌─────────────────────────┐
│ Shell (cpanel) renderiza│
│ com X-Fragment-Route    │
└─────────────────────────┘
```

### Exemplos de Roteamento

| Request | Destino | Motivo |
|---------|---------|--------|
| `GET /` | Shell | Homepage |
| `GET /metrics` | Shell | Base exato de plugin |
| `GET /metrics/` | Shell | Base com trailing slash |
| `GET /metrics/api/data` | Worker | Subrota |
| `GET /metrics/workers` | Worker | Subrota |
| `GET /metrics/style.css` | Worker | Asset |
| `GET /api/plugins` | Worker | API central |
| `GET /keyval` | Shell | Base exato de plugin |
| `GET /keyval/api/keys` | Worker | Subrota |

## Implementação

### Passo 1: Adicionar `shell` ao BuntimePlugin Type

**Arquivo:** `packages/shared/src/types/plugin.ts`

```typescript
export interface BuntimePlugin {
  name: string;
  base: string;
  shell?: boolean;  // NOVO: indica que este plugin é um app-shell
  // ...resto existente
}
```

### Passo 2: Atualizar Resolução de Homepage

**Arquivo:** `runtime/src/config.ts`

```typescript
interface ResolvedHomepage {
  target: string;      // path ou plugin name
  isPlugin: boolean;   // true se começa com @
  isShell: boolean;    // true se plugin tem shell: true
}

function resolveHomepage(
  homepage: string | undefined,
  registry: PluginRegistry | undefined,
): ResolvedHomepage | undefined {
  if (!homepage) return undefined;

  const isPlugin = homepage.startsWith("@");

  if (isPlugin && registry) {
    const plugin = registry.get(homepage);
    return {
      target: plugin?.base || homepage,
      isPlugin: true,
      isShell: plugin?.shell === true,
    };
  }

  return {
    target: homepage,
    isPlugin: false,
    isShell: false,  // Workers avulsos nunca são shell
  };
}
```

### Passo 3: Coletar Base Paths dos Plugins

**Arquivo:** `runtime/src/plugins/registry.ts`

```typescript
class PluginRegistry {
  // ...existente...

  /**
   * Get all plugin base paths for shell routing
   */
  getPluginBasePaths(): Set<string> {
    const bases = new Set<string>();
    for (const plugin of this.getAll()) {
      bases.add(plugin.base);
    }
    return bases;
  }

  /**
   * Get the shell plugin if any
   */
  getShellPlugin(): BuntimePlugin | undefined {
    return this.getAll().find(p => p.shell === true);
  }
}
```

### Passo 4: Implementar Lógica de App Shell

**Arquivo:** `runtime/src/app.ts`

```typescript
function shouldRouteToShell(
  pathname: string,
  pluginBases: Set<string>,
): boolean {
  // Homepage sempre vai pro shell
  if (pathname === "/" || pathname === "") {
    return true;
  }

  // Verifica se é base exato de algum plugin
  for (const base of pluginBases) {
    if (pathname === base || pathname === `${base}/`) {
      return true;
    }
  }

  return false;
}

// No catch-all handler:
app.all("*", async (ctx) => {
  const pathname = ctx.req.path;
  const resolved = resolveHomepage(config.homepage, registry);

  // Se homepage é um shell plugin
  if (resolved?.isShell) {
    const pluginBases = registry?.getPluginBasePaths() ?? new Set();

    if (shouldRouteToShell(pathname, pluginBases)) {
      // Rotear para o shell com header indicando o fragment
      const shellReq = new Request(ctx.req.url, ctx.req.raw);
      shellReq.headers.set("X-Fragment-Route", pathname);

      // Servir o shell (sempre em /)
      return serveShellApp(shellReq, pool, resolved.target);
    }
  }

  // Redirect tradicional para GET /
  if (pathname === "/" && resolved && !resolved.isShell) {
    return ctx.redirect(resolved.target);
  }

  // ...resto do roteamento atual...
});
```

### Passo 5: Injetar Fragment Route no HTML

**Arquivo:** `runtime/src/libs/pool/wrapper.ts`

Ao servir o shell, injetar o fragment route para o client-side:

```typescript
// Além do <base href>, injetar script com fragment route
const fragmentRoute = req.headers.get("X-Fragment-Route") || "/";

// Só injeta se for shell (quando tem X-Fragment-Route)
if (fragmentRoute) {
  const injection = `
    <base href="/">
    <script>window.__FRAGMENT_ROUTE__ = "${fragmentRoute}";</script>
  `;
}
```

### Passo 6: Atualizar Shell (cpanel) para Declarar shell: true

**Arquivo:** `plugins/plugin-cpanel/plugin.ts`

```typescript
export default function cpanelPlugin(): BuntimePlugin {
  return {
    name: "@buntime/plugin-cpanel",
    base: "/cpanel",
    shell: true,  // NOVO
    // ...resto existente
  };
}
```

### Passo 7: Client-Side - Ler Fragment Route Inicial

**Arquivo:** `plugins/plugin-cpanel/client/main.tsx`

```typescript
// No mount inicial do shell
const initialFragment = window.__FRAGMENT_ROUTE__ || "/";

// Se não está na raiz, navegar para o fragment
if (initialFragment !== "/") {
  router.navigate({ to: initialFragment });
}
```

### Passo 8: Atualizar buntime.jsonc

**Arquivo:** `runtime/buntime.jsonc`

```jsonc
{
  "homepage": "@buntime/plugin-cpanel",  // plugin com shell: true
  // ...resto
}
```

## Arquivos a Modificar

| Arquivo | Mudança |
|---------|---------|
| `packages/shared/src/types/plugin.ts` | Adicionar `shell?: boolean` |
| `runtime/src/config.ts` | `resolveHomepage()` com detecção de shell |
| `runtime/src/plugins/registry.ts` | `getPluginBasePaths()`, `getShellPlugin()` |
| `runtime/src/app.ts` | Lógica de roteamento para shell |
| `runtime/src/libs/pool/wrapper.ts` | Injeção de `__FRAGMENT_ROUTE__` |
| `plugins/plugin-cpanel/plugin.ts` | Adicionar `shell: true` |
| `plugins/plugin-cpanel/client/main.tsx` | Leitura do fragment inicial |
| `runtime/buntime.jsonc` | Atualizar para usar nome do plugin |

## Considerações

### Por que só Plugins podem ser Shell?

Workers avulsos não têm como declarar `shell: true` - só plugins têm a estrutura para declarar metadata. Isso é aceitável porque um shell precisa de:

- Rotas próprias (layout, sidebar)
- Lógica de fragments/piercing
- Contexto compartilhado

Um worker avulso simples não teria essa estrutura.

### Navegação Client-Side

Após o carregamento inicial, a navegação entre fragments é client-side (sem full page reload). Isso já funciona com o piercing atual.

### Deep Links

URLs como `https://app.com/metrics/workers`:

1. Browser faz `GET /metrics/workers`
2. Runtime detecta: `/metrics/workers` não é base exato
3. Vai direto ao worker metrics
4. Metrics retorna HTML standalone

**Solução:** O fragment detecta que está fora do shell e redireciona:

```typescript
// No fragment (metrics)
if (!isInShadowDom()) {
  // Standalone access - redirect para shell
  window.location.href = `/${window.location.pathname}`;
}
```

### Backwards Compatibility

- `homepage: "/my-app"` continua funcionando (redirect)
- `homepage: "@buntime/plugin-x"` com `shell: false` = redirect
- `homepage: "@buntime/plugin-x"` com `shell: true` = app-shell

### Comunicação Shell ↔ Fragment

Já implementada pelo piercing via MessageBus:

```typescript
// Fragment → Shell (navegação)
piercing.navigate('/metrics/details');
// Emite evento "fragment:navigate" para o shell

// Shell escuta
bus.listen("fragment:navigate", (event) => {
  router.navigate(event.url);
});

// Eventos genéricos
piercing.dispatch("custom:event", { data });
bus.listen("custom:event", callback);
```

Não é necessário implementar nada novo para comunicação.

### 404 do App Shell

Quando nenhum plugin, worker ou proxy responde a uma rota, o app-shell deve exibir uma página 404 consistente com seu layout.

**Implementação no runtime (`app.ts`):**

```typescript
// Após tentar todos os handlers (plugins, workers, proxy)
// Se nenhum respondeu e temos um shell ativo:

if (resolved?.isShell && response.status === 404) {
  // Roteia para o shell com indicação de 404
  const shellReq = new Request(ctx.req.url, ctx.req.raw);
  shellReq.headers.set("X-Fragment-Route", pathname);
  shellReq.headers.set("X-Not-Found", "true");

  return serveShellApp(shellReq, pool, resolved.target);
}
```

**Implementação no shell (cpanel):**

```typescript
// No shell, detectar header X-Not-Found
const isNotFound = window.__NOT_FOUND__ === true;

// Ou via rota catch-all do TanStack Router
// routes/$.tsx
function CatchAllRoute() {
  const pathname = useLocation().pathname;
  const knownBases = usePluginBases(); // lista de bases conhecidos

  const isKnownFragment = knownBases.some(base =>
    pathname === base || pathname.startsWith(`${base}/`)
  );

  if (!isKnownFragment) {
    return <NotFoundPage />;
  }

  return <FragmentOutlet src={pathname} />;
}
```

**Injeção do estado no wrapper.ts:**

```typescript
const notFound = req.headers.get("X-Not-Found") === "true";

const injection = `
  <base href="/">
  <script>
    window.__FRAGMENT_ROUTE__ = "${fragmentRoute}";
    window.__NOT_FOUND__ = ${notFound};
  </script>
`;
```

**Comportamento:**

| Cenário | Resultado |
|---------|-----------|
| `/metrics` (plugin existe) | Shell carrega fragment metrics |
| `/unknown` (nada existe) | Shell exibe página 404 |
| `/metrics/rota-invalida` | Worker metrics trata seu próprio 404 |

## Testes Necessários

- [ ] Worker avulso como homepage → redirect
- [ ] Plugin sem `shell` como homepage → redirect
- [ ] Plugin com `shell: true` como homepage → app-shell
- [ ] `GET /` → Shell renderiza
- [ ] `GET /metrics` → Shell renderiza com fragment metrics
- [ ] `GET /metrics/api/data` → Worker direto
- [ ] `GET /metrics/style.css` → Worker direto
- [ ] Deep link `/metrics/workers` → Standalone ou redirect
- [ ] Client-side navigation entre fragments
- [ ] Proxy apps funcionando normalmente
- [ ] `GET /rota-inexistente` → Shell exibe 404 com layout
- [ ] `GET /metrics/rota-invalida` → Fragment metrics trata seu 404

## Dependências

- Nenhuma nova dependência externa
- Depende da arquitetura de fragments/piercing existente

## Riscos

1. **Performance**: Adiciona verificação em cada request
   - Mitigação: Set lookup é O(1)

2. **Deep links**: Comportamento pode ser confuso
   - Mitigação: Documentar claramente, fragment auto-redirect

3. **SEO**: Conteúdo dentro do shell pode não ser indexável
   - Mitigação: Fragments funcionam standalone também

## Resumo da Mudança

| Antes | Depois |
|-------|--------|
| Config decide o modo | Plugin decide o modo |
| `homepage: { mode: "app-shell" }` | `homepage: "@plugin"` + `plugin.shell: true` |
| Complexidade na config | Encapsulamento no plugin |
| Workers podem ser shell | Só plugins podem ser shell |
