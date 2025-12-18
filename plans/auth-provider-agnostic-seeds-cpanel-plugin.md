# Plano: Arquitetura de Auth Provider-Agnostic + Seeds + CPanel como Plugin

## Contexto

- Sistema rodará no Kubernetes com Keycloak
- plugin-authn não pode ficar restrito ao Keycloak (deve suportar Auth0, Okta, etc)
- Seeds devem ser configuráveis para rodar em qualquer ambiente
- cpanel será movido para plugin para gerenciar suas próprias políticas

---

## Parte 1: plugin-authn Provider-Agnostic

### Problema Atual

O plugin está acoplado ao Keycloak:
- Hardcoded: `keycloak()` helper do better-auth
- Config específica: `issuer` + `realm` (padrão Keycloak)
- Cliente hardcoded: `providerId: "keycloak"`

### Arquitetura Proposta: Multi-Provider com Adapter Pattern

Suportar múltiplos providers simultaneamente, incluindo email/senha nativo do better-auth:

```typescript
// Tipos de provider
type AuthProviderType = "email-password" | "keycloak" | "auth0" | "okta" | "generic-oidc";

// Config base para OAuth providers
interface BaseOAuthProviderConfig {
  type: Exclude<AuthProviderType, "email-password">;
  clientId: string;
  clientSecret: string;
  displayName?: string;
  icon?: string;
}

// Email/Password (nativo better-auth)
interface EmailPasswordProviderConfig {
  type: "email-password";
  displayName?: string;           // default: "Email"
  icon?: string;                  // default: "lucide:mail"
  requireEmailVerification?: boolean;  // default: false
  allowSignUp?: boolean;          // default: true
}

// Keycloak
interface KeycloakProviderConfig extends BaseOAuthProviderConfig {
  type: "keycloak";
  issuer: string;
  realm: string;
}

// Auth0
interface Auth0ProviderConfig extends BaseOAuthProviderConfig {
  type: "auth0";
  domain: string;  // tenant.auth0.com
}

// Okta
interface OktaProviderConfig extends BaseOAuthProviderConfig {
  type: "okta";
  domain: string;  // tenant.okta.com
}

// OIDC Genérico
interface GenericOIDCProviderConfig extends BaseOAuthProviderConfig {
  type: "generic-oidc";
  issuer: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
}

type ProviderConfig = 
  | EmailPasswordProviderConfig 
  | KeycloakProviderConfig 
  | Auth0ProviderConfig 
  | OktaProviderConfig 
  | GenericOIDCProviderConfig;

// Config do plugin - ARRAY de providers
interface AuthnConfig {
  providers: ProviderConfig[];    // Múltiplos providers
  databasePath?: string;
  trustedOrigins?: string[];
  loginPath?: string;
}
```

### Interface do Adapter

```typescript
// server/providers/types.ts
interface AuthProvider {
  type: string;
  getIssuerUrl(): string;
  getProviderConfig(): object;  // config para better-auth
  getDisplayName(): string;
  getIcon(): string;
}
```

### Estrutura de Arquivos

```
plugins/plugin-authn/
├── server/
│   ├── providers/
│   │   ├── types.ts           # Interface AuthProvider
│   │   ├── keycloak.ts        # KeycloakProvider
│   │   ├── auth0.ts           # Auth0Provider
│   │   ├── okta.ts            # OktaProvider
│   │   ├── generic-oidc.ts    # GenericOIDCProvider
│   │   └── index.ts           # Factory createProvider()
│   ├── auth.ts                # Usa provider.getProviderConfig()
│   ├── api.ts                 # Novo endpoint /provider-info
│   └── services.ts
└── client/
    └── app.tsx                # Busca provider-info para UI dinâmica
```

### Exemplo de Config (buntime.jsonc)

```jsonc
// Apenas Email/Password (desenvolvimento local)
["@buntime/plugin-authn", {
  "providers": [
    { "type": "email-password", "allowSignUp": true }
  ]
}]

// Apenas Keycloak (produção)
["@buntime/plugin-authn", {
  "providers": [
    {
      "type": "keycloak",
      "issuer": "${KEYCLOAK_URL}",
      "realm": "${KEYCLOAK_REALM}",
      "clientId": "${KEYCLOAK_CLIENT_ID}",
      "clientSecret": "${KEYCLOAK_CLIENT_SECRET}"
    }
  ]
}]

// Múltiplos providers (Email + Keycloak + Google)
["@buntime/plugin-authn", {
  "providers": [
    { "type": "email-password", "displayName": "Email" },
    {
      "type": "keycloak",
      "displayName": "SSO Corporativo",
      "icon": "lucide:building",
      "issuer": "${KEYCLOAK_URL}",
      "realm": "${KEYCLOAK_REALM}",
      "clientId": "${KEYCLOAK_CLIENT_ID}",
      "clientSecret": "${KEYCLOAK_CLIENT_SECRET}"
    },
    {
      "type": "generic-oidc",
      "displayName": "Google",
      "icon": "logos:google-icon",
      "issuer": "https://accounts.google.com",
      "clientId": "${GOOGLE_CLIENT_ID}",
      "clientSecret": "${GOOGLE_CLIENT_SECRET}"
    }
  ]
}]
```

### Login Page com Múltiplos Providers

O cliente busca `/api/providers` e renderiza botões dinamicamente:

```typescript
// GET /api/providers retorna:
[
  { "type": "email-password", "displayName": "Email", "icon": "lucide:mail" },
  { "type": "keycloak", "displayName": "SSO Corporativo", "icon": "lucide:building" },
  { "type": "generic-oidc", "displayName": "Google", "icon": "logos:google-icon", "providerId": "google" }
]

// Cliente renderiza:
// - Form de email/senha (se email-password presente)
// - Botões OAuth para cada provider
```

---

## Parte 2: Seeds de Políticas (plugin-authz)

### Objetivo

Seeds específicos para políticas de autorização no plugin-authz.
Outros plugins (como authn) não terão seeds - usuários devem ser provisionados via IdP (Keycloak realm import, etc).

### Config

```typescript
interface PolicySeedConfig {
  enabled?: boolean;           // default: true
  onlyIfEmpty?: boolean;       // default: true (não sobrescreve existentes)
  environments?: string[];     // default: ["*"] (todos ambientes)
  file?: string;               // caminho para arquivo JSON de políticas
  policies?: Policy[];         // políticas inline
}

// Config do plugin-authz
interface AuthzConfig {
  policySeed?: PolicySeedConfig;  // Nome específico: policySeed (não seed genérico)
  // ... outras configs
}
```

### Exemplo de Config (buntime.jsonc)

```jsonc
["@buntime/plugin-authz", {
  "policySeed": {
    "enabled": true,
    "environments": ["*"],
    "policies": [
      {
        "id": "admin-full-access",
        "name": "Admin Full Access",
        "effect": "permit",
        "subjects": [{ "role": "admin" }],
        "resources": [{ "path": "*" }],
        "actions": [{ "method": "*" }]
      }
    ]
  }
}]

// Ou via arquivo
["@buntime/plugin-authz", {
  "policySeed": {
    "enabled": true,
    "file": "./seeds/policies.json"
  }
}]
```

### Implementação no plugin-authz

```typescript
// plugin.ts
async onInit(ctx: PluginContext) {
  // ... inicialização existente ...
  
  // Seed de políticas
  if (config.policySeed?.enabled !== false) {
    await runPolicySeed(ctx, config.policySeed);
  }
}

// server/seed.ts
async function runPolicySeed(ctx: PluginContext, config?: PolicySeedConfig) {
  if (!config) return;
  
  // Verificar ambiente
  const env = Bun.env.NODE_ENV || "development";
  const allowedEnvs = config.environments || ["*"];
  if (!allowedEnvs.includes("*") && !allowedEnvs.includes(env)) {
    ctx.logger.debug(`Policy seed skipped - env ${env} not allowed`);
    return;
  }
  
  // Verificar se já tem políticas
  if (config.onlyIfEmpty !== false && pap.getAll().length > 0) {
    ctx.logger.info("Policy seed skipped - policies already exist");
    return;
  }
  
  // Carregar políticas
  const policies = config.file
    ? JSON.parse(await Bun.file(config.file).text())
    : config.policies;
  
  if (!policies?.length) return;
  
  // Aplicar
  for (const policy of policies) {
    await pap.set(policy);
  }
  
  ctx.logger.info(`Policy seed: ${policies.length} policies applied`);
}
```

---

## Parte 3: CPanel como Plugin

### Motivação

- CPanel pode registrar suas próprias políticas de authz
- Arquitetura unificada (tudo é plugin)
- Melhor isolamento e lifecycle hooks

### Estrutura Proposta

```
plugins/plugin-cpanel/
├── plugin.ts              # Plugin definition
├── index.ts               # Worker entry (createStaticHandler)
├── server/
│   └── api.ts             # APIs específicas do cpanel (se houver)
├── client/                # React SPA (mesmo código atual)
│   ├── index.html
│   ├── index.tsx
│   ├── routes/
│   └── ...
└── scripts/
    └── build.ts
```

### plugin.ts

```typescript
export default function cpanelPlugin(config: CpanelConfig = {}): BuntimePlugin {
  return {
    name: "@buntime/plugin-cpanel",
    dependencies: ["@buntime/plugin-authz"],
    
    // CPanel é servido na raiz
    base: "/cpanel",  // ou "/" se for homepage
    
    // Não é um fragment (é o shell)
    fragment: undefined,
    
    // CPanel não aparece no menu dele mesmo
    menus: [],
    
    async onInit(ctx) {
      // Registrar políticas do cpanel no authz
      const authz = ctx.getService<AuthzService>("authz");
      if (authz && config.policySeed?.policies) {
        await authz.seedPolicies(config.policySeed.policies);
        ctx.logger.info(`CPanel: ${config.policySeed.policies.length} policies registered`);
      }
    },
  };
}
```

### Config do CPanel

```jsonc
["@buntime/plugin-cpanel", {
  "policySeed": {
    "policies": [
      {
        "id": "cpanel-admin-access",
        "effect": "permit",
        "subjects": [{ "role": "admin" }],
        "resources": [{ "app": "cpanel", "path": "*" }],
        "actions": [{ "method": "*" }]
      },
      {
        "id": "cpanel-viewer-readonly",
        "effect": "permit",
        "subjects": [{ "role": "viewer" }],
        "resources": [{ "app": "cpanel", "path": "*" }],
        "actions": [{ "method": "GET" }]
      }
    ]
  }
}]
```

### Mudanças no Runtime

1. Remover `homepage` do buntime.jsonc
2. Atualizar routing para permitir plugin em `/cpanel` ou `/`
3. Plugin-cpanel servido como qualquer outro plugin com UI

---

## Ordem de Implementação

### Fase 1: Provider-Agnostic (plugin-authn) ✅ CONCLUÍDO
1. ✅ Criar interface AuthProvider (`server/providers/types.ts`)
2. ✅ Implementar EmailPasswordProvider (`server/providers/email-password.ts`)
3. ✅ Implementar KeycloakProvider (`server/providers/keycloak.ts`)
4. ✅ Implementar Auth0Provider (`server/providers/auth0.ts`)
5. ✅ Implementar OktaProvider (`server/providers/okta.ts`)
6. ✅ Implementar GenericOIDCProvider (`server/providers/generic-oidc.ts`)
7. ✅ Criar factory (`server/providers/index.ts`)
8. ✅ Atualizar auth.ts para multi-provider
9. ✅ Atualizar api.ts com endpoint `/providers`
10. ✅ Atualizar plugin.ts config interface
11. ✅ Atualizar cliente app.tsx para multi-provider login

### Fase 2: Seeds de Políticas (plugin-authz) ✅ CONCLUÍDO
1. ✅ Adicionar `PolicySeedConfig` interface em plugin.ts
2. ✅ Implementar `runPolicySeed()` function
3. ✅ Expor serviço `AuthzService` com `seedPolicies()` para outros plugins
4. ✅ Registrar serviço no `onInit`

### Fase 3: CPanel como Plugin ✅ CONCLUÍDO
1. ✅ Criar plugins/plugin-cpanel/ com estrutura de plugin
2. ✅ Criar plugin.ts com PolicySeed via AuthzService
3. ✅ Criar index.ts (worker entry com createStaticHandler)
4. ✅ Copiar client/ de apps/cpanel@latest
5. ✅ Criar package.json com dependências
6. ✅ Criar bunfig.toml e tsconfig.json
7. ✅ Remover homepage do buntime.jsonc
8. ✅ Adicionar @buntime/plugin-cpanel aos plugins
9. ✅ Atualizar plugin-authn config para usar multi-provider

---

## Arquivos a Modificar/Criar

### Fase 1
- `plugins/plugin-authn/server/providers/types.ts` (criar)
- `plugins/plugin-authn/server/providers/keycloak.ts` (criar)
- `plugins/plugin-authn/server/providers/auth0.ts` (criar)
- `plugins/plugin-authn/server/providers/okta.ts` (criar)
- `plugins/plugin-authn/server/providers/generic-oidc.ts` (criar)
- `plugins/plugin-authn/server/providers/index.ts` (criar)
- `plugins/plugin-authn/server/auth.ts` (modificar)
- `plugins/plugin-authn/server/api.ts` (modificar - adicionar /provider-info)
- `plugins/plugin-authn/plugin.ts` (modificar)
- `plugins/plugin-authn/client/app.tsx` (modificar)

### Fase 2
- `plugins/plugin-authz/server/seed.ts` (criar)
- `plugins/plugin-authz/plugin.ts` (modificar)
- `plugins/plugin-authz/server/pap.ts` (modificar - adicionar seedPolicies)

### Fase 3
- `plugins/plugin-cpanel/` (criar - mover de apps/cpanel@latest)
- `runtime/buntime.jsonc` (modificar)
- `runtime/src/app.ts` (modificar se necessário)
