# Shell como Worker (não Plugin)

## Objetivo

Remover suporte a `shell: true` de plugins e permitir apenas workers como app-shell.

## Motivação

- Plugins são para funcionalidades do runtime (auth, database, metrics)
- Shell é UI - deveria ser um worker como qualquer outro app
- Simplifica a arquitetura: shell = worker com config especial
- Permite shells customizados sem criar plugins

## Histórico de Commits (Referência/Rollback)

O cpanel já foi um worker antes de ser migrado para plugin:

| Commit | Data | Descrição |
|--------|------|-----------|
| `dfc3fe3` | Dec 12 | cpanel como app standalone em `apps/cpanel/` |
| `9591d65` | Dec 13 | Merge cpanel + playground em `apps/runner/` |
| `9dca750` | Dec 17 | Migração para `plugins/plugin-cpanel/` |

**Para ver estrutura antiga:**
```bash
# Estrutura de apps/cpanel antes da migração
git ls-tree -r dfc3fe3 --name-only | grep "^apps/cpanel/"

# Diff completo da migração para plugin
git show 9dca750 --stat
```

**Rollback se necessário:**
```bash
# Ver estado do cpanel como worker
git show dfc3fe3:apps/cpanel/package.json
git show dfc3fe3:apps/cpanel/bunfig.toml
```

## Mudanças

### 1. buntime.jsonc

**Antes:**
```jsonc
{
  "homepage": "@buntime/plugin-cpanel"
}
```

**Depois:**
```jsonc
{
  "homepage": {
    "app": "cpanel",
    "shell": true
  }
}
```

Onde `app` é o nome de um worker (não plugin).

### 2. Migrar cpanel de plugin para worker

```
plugins/plugin-cpanel/  →  apps/cpanel/
```

**Estrutura:**
```
apps/cpanel/
├── client/
│   ├── index.html
│   ├── index.tsx
│   └── routes/
├── buntime.json
└── package.json
```

**buntime.json:**
```jsonc
{
  "entrypoint": "client/index.html",
  "publicRoutes": {
    "GET": ["/*.js", "/*.css", "/*.woff2", "/*.png", "/*.svg"]
  }
}
```

### 3. Policies via config do authz

Mover seed de policies para config:

```jsonc
["@buntime/plugin-authz", {
  "policies": [
    {
      "id": "admin-full-access",
      "effect": "permit",
      "subjects": [{ "role": "admin" }],
      "resources": [{ "path": "/**" }],
      "actions": [{ "method": "*" }]
    }
  ]
}]
```

### 4. Remover do runtime

- `shell?: boolean` do tipo `BuntimePlugin`
- `getShellPlugin()` do registry
- Suporte a `homepage: "@plugin-name"` (apenas workers)

### 5. Atualizar app.ts

```typescript
interface HomepageConfig {
  app: string;      // Nome do worker
  shell: boolean;   // Ativa modo app-shell
}

async function resolveShell(
  homepage: HomepageConfig,
  getAppDir: (name: string) => string | undefined,
): Promise<ResolvedShell | undefined> {
  if (!homepage.shell) return undefined;

  const dir = getAppDir(homepage.app);
  if (!dir) return undefined;

  const config = await loadWorkerConfig(dir);
  return {
    name: homepage.app,
    dir,
    base: `/${homepage.app}`,
    config,
  };
}
```

### 6. Atualizar plugin-authz

```typescript
interface AuthzConfig {
  policies?: Policy[];  // Novo
  // ...
}

async onInit(ctx) {
  if (config.policies?.length) {
    await this.seedPolicies(config.policies);
  }
}
```

## Ordem de Implementação

1. Adicionar suporte a `policies` no authz config
2. Criar `apps/cpanel/` com estrutura de worker
3. Atualizar parser de homepage para novo formato
4. Atualizar `resolveShell` para usar workers
5. Remover `plugins/plugin-cpanel/`
6. Remover `shell` do tipo BuntimePlugin
7. Atualizar documentação

## Arquivos a Modificar

| Arquivo | Mudança |
|---------|---------|
| `packages/shared/src/types/plugin.ts` | Remover `shell?: boolean` |
| `runtime/src/config.ts` | Parse do novo formato de homepage |
| `runtime/src/app.ts` | `resolveShell` para workers |
| `runtime/src/plugins/registry.ts` | Remover `getShellPlugin`, `shouldRouteToShell` |
| `plugins/plugin-authz/plugin.ts` | Suportar `policies` em config |
| `runtime/buntime.jsonc` | Novo formato de homepage |

## Arquivos a Criar

| Arquivo | Descrição |
|---------|-----------|
| `apps/cpanel/buntime.json` | Config do worker |
| `apps/cpanel/package.json` | Dependências |
| `apps/cpanel/client/*` | Copiar de plugin-cpanel |

## Arquivos a Remover

| Arquivo | Motivo |
|---------|--------|
| `plugins/plugin-cpanel/` | Migrado para worker |
