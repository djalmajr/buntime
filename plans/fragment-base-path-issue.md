# Problema: Fragment Base Path no Shell

**Status: RESOLVIDO (v2)**

## Contexto

O cpanel foi movido para `plugins/plugin-cpanel` e agora é servido como um plugin em `/cpanel`. Os fragments (metrics, logs, health, etc.) são carregados dentro do cpanel via `<fragment-outlet>`.

## Arquitetura Atual (v2 - Sem /p/ forçado)

### Mudança Principal

O runtime **não força mais** o prefixo `/p/` nos plugins. Cada plugin define seu próprio `base` ou usa o padrão `/{shortName}`.

### URLs

```
URL do navegador: /cpanel/metrics/workers
                  ├──────┤├─────────────┤
                  shell   fragment path

Shell (cpanel):
- Servido em: /cpanel
- <base href="/cpanel/">
- Renderiza: <fragment-outlet src="/metrics/workers" base="/cpanel/metrics" />

Fragment (metrics):
- Servido em: /metrics
- Assets: /metrics/chunk-*.js
- Router basepath: /cpanel/metrics (passado via atributo base)
```

### Dois Conceitos de Base

1. **Asset base** (server-side): Onde os arquivos .js/.css estão servidos
   - Definido pelo runtime via `x-base` header
   - Injetado como `<base href>` no HTML
   - Exemplo: `/metrics/`

2. **Router base** (client-side): Basepath do TanStack Router
   - Passado via atributo `base` do fragment-outlet
   - Lido pelo fragment via Shadow DOM
   - Exemplo: `/cpanel/metrics`

## Arquivos Modificados

### Runtime

- **`runtime/src/plugins/loader.ts`**: Removido `normalizeBase()` que forçava `/p/`
- **`runtime/src/utils/plugin-paths.ts`**: `getPluginBase()` agora retorna `/{name}` sem `/p/`
- **`runtime/buntime.jsonc`**: `homepage: "/cpanel"` e `excludePaths` para assets estáticos

### Shell (cpanel)

- **`plugin-cpanel/client/routes/__root.tsx`**: Menus usam paths diretos (sem adicionar `/p/`)
- **`plugin-cpanel/client/routes/$.tsx`**: FragmentRouter usa pathname direto como `src`
- **`plugin-cpanel/plugin.ts`**: Adicionado `publicRoutes` para assets estáticos

### Plugins

Plugins definem seu próprio `base` no `plugin.ts`:
- `plugin-cpanel`: `base: "/cpanel"`
- `plugin-authn`: `base: "/auth"`
- Outros: usam default `/{shortName}`

## Fluxo de Navegação

```
1. Usuário acessa http://localhost:8000
2. Runtime redireciona para /cpanel (homepage do shell)
3. Cpanel redireciona para /metrics (primeiro plugin com UI)
4. URL final: /cpanel/metrics

Navegação para /cpanel/keyval/entries:
1. TanStack Router do cpanel: pathname = /keyval/entries
2. FragmentRouter extrai segment = "keyval"
3. <fragment-outlet src="/keyval/entries" base="/cpanel/keyval">
4. Fragment fetch: GET /keyval/entries
5. Runtime serve keyval plugin
6. Fragment inicializa com basepath = /cpanel/keyval
```

## Plugins Paths

| Plugin | Base Path | Notas |
|--------|-----------|-------|
| cpanel | /cpanel | Shell principal |
| metrics | /metrics | Fragment |
| keyval | /keyval | Fragment |
| database | /database | Fragment |
| logs | /logs | Fragment |
| health | /health | Fragment |
| deployments | /deployments | Sem UI |
| authn | /auth | Rotas de autenticação |

## API Base Path (v3)

### Problema

Após remover o `/p/` prefix, os fragments ainda usavam `getBasePath()` para construir URLs de API. Porém, `getBasePath()` retorna o **router base** (ex: `/cpanel/health`) ao invés do **API base** (ex: `/health`).

### Solução

Criada função `getApiBase()` em cada plugin que:
1. Busca o elemento root do plugin (ex: `#plugin-health-root`)
2. Navega pelo Shadow DOM até o `fragment-outlet`
3. Extrai o primeiro segmento do atributo `src` (ex: `/health` de `/health/status`)
4. Usa fallback para base tag em modo standalone

### Arquivos Modificados

- `plugin-database/client/helpers/api.ts`: Usa `getApiBase()` para construir URLs de API
- `plugin-health/client/components/health-dashboard.tsx`: `getBasePath()` -> `getApiBase()`
- `plugin-metrics/client/helpers/sse.ts`: `getBasePath()` -> `getApiBase()`
- `plugin-logs/client/components/logs-table.tsx`: `getBasePath()` -> `getApiBase()`
- `plugin-authz/client/utils/api.ts`: `getBasePath()` -> `getApiBase()`
- `plugin-deployments/client/utils/api.ts`: `getBasePath()` -> `getApiBase()`
- `plugin-gateway/client/components/gateway-page.tsx`: `getBasePath()` -> `getApiBase()`
- `plugin-keyval/client/helpers/kv.ts`: Usa `getApiBase()` para construir URLs de API
- `plugin-cpanel/client/hooks/use-authorization.ts`: Usa `/authz/api/evaluate` para chamadas de API
- `plugin-cpanel/client/routes/redirects.tsx`: Usa `/proxy` como base path

### Padrão getApiBase()

```typescript
function getApiBase(): string {
  const rootElement = document.getElementById("plugin-{name}-root");
  if (!rootElement) return "/{name}";

  const rootNode = rootElement.getRootNode();
  if (rootNode instanceof ShadowRoot) {
    const outlet = rootNode.host;
    const src = outlet?.getAttribute("src");
    if (src) {
      const match = src.match(/^(\/[^/]+)/);
      return match?.[1] || "/{name}";
    }
  }

  const base = document.querySelector("base");
  if (base) {
    const href = base.getAttribute("href") || "";
    return href.replace(/\/$/, "") || "/{name}";
  }
  return "/{name}";
}
```

## Testado

- [x] Plugins carregando sem /p/ prefix
- [x] Homepage redireciona para /cpanel
- [x] Cpanel redireciona para /metrics
- [x] Navegação entre fragments funcionando
- [x] Assets carregando corretamente
- [x] Client-side navigation entre fragmentos
- [x] API calls usando base path correto (ex: /health/api, /metrics/api/sse)

## Benefícios da Nova Arquitetura

1. **Simplicidade**: URLs mais limpas sem duplicação de `/p/`
2. **Flexibilidade**: Plugins controlam seu próprio base path
3. **Consistência**: Menu paths = fetch paths = router paths
4. **Menos mágica**: Runtime não modifica paths automaticamente
