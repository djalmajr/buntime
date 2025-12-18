# Database Studio - Testing Bloqueado por Autenticação

## Contexto

Estávamos testando melhorias no Database Studio (`plugin-database`) com dados volumosos:
- 500 linhas
- 30 colunas de tipos variados

## Melhorias Implementadas (Concluídas)

1. **Column Sizing**
   - Extraído valores fixos para constante `COLUMN_SIZE` (min: 80, max: 500, select: 40)
   - Clamping de valores no cálculo de CSS variables para garantir min/max
   - Checkbox column com `enableResizing: false`

2. **Horizontal Scroll**
   - Header e body agora scrollam juntos horizontalmente
   - Header com `sticky top-0` para permanecer visível durante scroll vertical

3. **Resizer Melhorado**
   - Hit area maior para facilitar clique na última coluna

## Problema Atual

### Sintoma
Ao tentar executar script de seed via API:
```bash
curl http://localhost:8000/database/api/health
# Retorna: HTTP 302 redirect para /auth/login
```

### Causa Raiz
O plugin `@buntime/plugin-database` não tem rotas públicas configuradas. Todas as rotas da API passam pelo middleware de autenticação do `@buntime/plugin-auth`.

### Arquivos Relevantes
- `/plugins/plugin-database/plugin.ts` - Não define `publicRoutes`
- `/plugins/plugin-database/server/api.ts` - Endpoints da API
- `/runtime/buntime.jsonc` - Configuração de plugins

## Soluções Possíveis

### Opção 1: Adicionar publicRoutes no plugin (Temporário para Dev)
```typescript
// plugin.ts
export default function databasePlugin(config: DatabasePluginConfig): BuntimePlugin {
  return {
    name: "@buntime/plugin-database",
    // Adicionar para desenvolvimento:
    publicRoutes: ["/api/query", "/api/tables", "/api/health"],
    // ...
  };
}
```

### Opção 2: Executar seed via Console do Browser
Como o usuário já está autenticado no browser, pode-se executar o script de seed diretamente no DevTools console. Script criado em `/tmp/seed-test-edit.ts` pode ser adaptado para rodar no browser.

### Opção 3: Criar endpoint de seed interno
Adicionar um endpoint específico para desenvolvimento que cria dados de teste:
```typescript
// Apenas em desenvolvimento
.post("/api/seed/test-edit", async (ctx) => { ... })
```

### Opção 4: Usar libsql-client diretamente
Conectar diretamente ao libSQL (porta 8880) sem passar pela API do plugin:
```bash
# Requer libsql-client instalado
libsql-client http://localhost:8880 < seed.sql
```

## Script de Seed (Pronto para Uso)

Localização: `/tmp/seed-test-edit.ts`

Cria tabela `test_edit` com:
- 30 colunas (TEXT, INTEGER, REAL, JSON)
- 500 linhas de dados realistas
- Tipos: uuid, name, email, phone, address, age, salary, score, etc.

## Próximos Passos

1. [ ] Escolher solução para bypass de autenticação (dev only)
2. [ ] Executar seed da tabela test_edit
3. [ ] Testar performance do Database Studio com dados volumosos
4. [ ] Verificar scroll, resize, edição em massa
5. [ ] Ajustar se necessário (virtualização, lazy loading, etc.)

## Observações

- O Database Studio já suporta paginação (50, 100, 250 rows por página)
- Pode ser necessário implementar virtualização se performance for ruim com muitas colunas visíveis
- Column visibility popover já tem search para facilitar navegação em muitas colunas
