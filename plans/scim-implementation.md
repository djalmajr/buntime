# SCIM Support para Plugin-Authn

## Objetivo
Adicionar suporte SCIM 2.0 ao plugin-authn, migrando para plugin-database e habilitando multi-tenancy.

## Decisões Arquiteturais

| Decisão | Escolha |
|---------|---------|
| Database | Migrar plugin-authn para usar plugin-database |
| Tenant ID | Gateway extrai do subdomain, injeta `X-Tenant-ID` header |
| SCIM | Dentro do plugin-authn (compartilha tabelas user/account) |
| Foco inicial | Keycloak como IdP |

---

## Fases de Implementação

### Fase 1: Migrar para Plugin-Database

#### 1.1 Criar schema.ts
**Arquivo:** `plugins/plugin-authn/server/schema.ts`

Tabelas:
- `user` - adicionar: `externalId`, `active`, `metadata`
- `session` - sem mudanças estruturais
- `account` - sem mudanças estruturais
- `verification` - sem mudanças estruturais
- `scim_group` - NOVA: grupos SCIM
- `scim_group_member` - NOVA: relação user-group
- `scim_token` - NOVA: tokens bearer para SCIM

#### 1.2 Criar better-auth-adapter.ts
**Arquivo:** `plugins/plugin-authn/server/better-auth-adapter.ts`

Bridge para better-auth usar `DatabaseAdapter`:
```typescript
export function createBetterAuthAdapter(adapter: DatabaseAdapter) {
  return {
    query: (sql, params) => adapter.execute(sql, params),
    execute: (sql, params) => adapter.execute(sql, params),
    batch: (statements) => adapter.batch(statements),
  };
}
```

#### 1.3 Atualizar services.ts
**Arquivo:** `plugins/plugin-authn/server/services.ts`

- Remover import de `bun:sqlite`
- Aceitar `DatabaseService` no `initialize()`
- Usar `database.getRootAdapter(config.adapterType)`

#### 1.4 Atualizar plugin.ts
**Arquivo:** `plugins/plugin-authn/plugin.ts`

```typescript
export default function authnPlugin(config: AuthnConfig): BuntimePlugin {
  return {
    name: "@buntime/plugin-authn",
    dependencies: ["@buntime/plugin-database"],  // ADICIONAR
    // ...
    async onInit(ctx) {
      const database = ctx.getService<DatabaseService>("database");
      // ...
    }
  };
}
```

---

### Fase 2: Implementar SCIM 2.0

#### 2.1 Estrutura de arquivos
```
server/scim/
├── types.ts      # Tipos SCIM (ScimUser, ScimGroup, etc)
├── mapper.ts     # DB <-> SCIM conversões
├── filter.ts     # Parser de filtros SCIM
├── service.ts    # Lógica de negócio
└── routes.ts     # Endpoints Hono
```

#### 2.2 Endpoints SCIM
```
GET    /auth/api/scim/v2/ServiceProviderConfig
GET    /auth/api/scim/v2/ResourceTypes
GET    /auth/api/scim/v2/Schemas

GET    /auth/api/scim/v2/Users
GET    /auth/api/scim/v2/Users/:id
POST   /auth/api/scim/v2/Users
PUT    /auth/api/scim/v2/Users/:id
PATCH  /auth/api/scim/v2/Users/:id
DELETE /auth/api/scim/v2/Users/:id

GET    /auth/api/scim/v2/Groups
GET    /auth/api/scim/v2/Groups/:id
POST   /auth/api/scim/v2/Groups
PUT    /auth/api/scim/v2/Groups/:id
PATCH  /auth/api/scim/v2/Groups/:id
DELETE /auth/api/scim/v2/Groups/:id

POST   /auth/api/scim/v2/Bulk
```

#### 2.3 Autenticação SCIM
- Bearer token via header `Authorization: Bearer <token>`
- Tokens armazenados em `scim_token` (hash SHA-256)
- Validação em middleware

#### 2.4 Filtros suportados
```
userName eq "john@example.com"
active eq true
name.familyName co "Silva"
externalId pr
```

---

### Fase 3: Configuração

#### 3.1 Schema de configuração
```typescript
interface AuthnConfig {
  database?: AdapterType;
  providers: ProviderConfigInput[];
  scim?: {
    enabled?: boolean;
    maxResults?: number;        // default: 100
    bulkEnabled?: boolean;      // default: true
    maxBulkOperations?: number; // default: 1000
  };
  trustedOrigins?: string[];
}
```

#### 3.2 Exemplo buntime.jsonc
```jsonc
{
  "plugins": [
    ["@buntime/plugin-database", {
      "adapters": [{ "type": "libsql", "default": true }],
      "tenancy": { "enabled": true, "header": "X-Tenant-ID" }
    }],
    ["@buntime/plugin-authn", {
      "database": "libsql",
      "providers": [
        { "type": "keycloak", "issuer": "${KEYCLOAK_URL}", ... }
      ],
      "scim": { "enabled": true }
    }]
  ]
}
```

---

### Fase 4: Migração

#### 4.1 Script de migração
**Arquivo:** `plugins/plugin-authn/scripts/migrate-to-database.ts`

```bash
bun run scripts/migrate-to-database.ts \
  --source ./data/auth.db \
  --target libsql://localhost:8880
```

---

## Arquivos a Modificar/Criar

### Modificar
| Arquivo | Mudança |
|---------|---------|
| `plugin.ts` | Adicionar dependency, config SCIM |
| `server/services.ts` | Usar DatabaseService |
| `server/auth.ts` | Usar adapter bridge |
| `server/api.ts` | Montar rotas SCIM |
| `package.json` | Adicionar dep plugin-database |

### Criar
| Arquivo | Propósito |
|---------|-----------|
| `server/schema.ts` | Definições de tabelas |
| `server/better-auth-adapter.ts` | Bridge para better-auth |
| `server/scim/types.ts` | Tipos SCIM 2.0 |
| `server/scim/mapper.ts` | Conversões DB <-> SCIM |
| `server/scim/filter.ts` | Parser de filtros |
| `server/scim/service.ts` | Lógica de negócio |
| `server/scim/routes.ts` | Endpoints Hono |
| `scripts/migrate-to-database.ts` | Script de migração |

---

## Sequência de Implementação

1. `schema.ts` - Definir tabelas
2. `better-auth-adapter.ts` - Bridge para better-auth
3. `services.ts` - Atualizar para usar DatabaseService
4. `plugin.ts` - Adicionar dependency e config
5. `auth.ts` - Usar adapter bridge
6. `scim/types.ts` - Tipos SCIM
7. `scim/mapper.ts` - Conversões
8. `scim/filter.ts` - Parser
9. `scim/service.ts` - Lógica
10. `scim/routes.ts` - Endpoints
11. `api.ts` - Montar rotas SCIM
12. `migrate-to-database.ts` - Script migração
13. Testes com Keycloak

---

## Multi-tenancy

O multi-tenancy é herdado automaticamente do plugin-database:

```
Request com X-Tenant-ID: tenant-123
    │
    ▼
plugin-authn chama database.getAdapter("libsql", "tenant-123")
    │
    ▼
LibSQL namespace "tenant-123" (isolado)
    │
    ▼
Dados do tenant isolados automaticamente
```

SCIM também respeita tenant:
- Cada tenant pode ter seus próprios tokens SCIM
- Cada tenant tem seus próprios users/groups
- Keycloak de cada tenant configura seu endpoint SCIM
