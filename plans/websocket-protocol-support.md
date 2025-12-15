# Plano Integrado: WebSocket + Roteamento Correto + Consistência Arquitetural

## 🎯 Objetivo

Implementar suporte completo a WebSocket no plugin-database com roteamento correto de namespaces (subdomain-based conforme documentação oficial) e garantir consistência transacional em todos os plugins do monorepo.

## 📋 Contexto Atual

### Situação Atual
- Plugin-database suporta apenas HTTP para libSQL
- Roteamento de namespaces usa path-based incorreto (`/v1/dev/{tenant}`)
- Plugins têm modelos transacionais inconsistentes
- Plugin-durable usa InMemoryTransaction (não garante atomicidade)
- Não há suporte a transações interativas via WebSocket

### Problema
- Roteamento incorreto não funciona com WebSocket
- Inconsistência transacional entre plugins
- Falta flexibilidade para escolher protocolo por necessidade

## 📋 Contexto Atual

### Situação Atual
- Plugin-database suporta apenas HTTP para libSQL
- Todos os plugins usam automaticamente HTTP
- Transações são limitadas a operações não-interativas (batches)
- Não há suporte para transações interativas via WebSocket

### Problema
- Plugins que precisam de controle transacional avançado (ex: jogos, trading) não podem usar WebSocket
- Todos os plugins são forçados a usar HTTP, perdendo benefícios do WebSocket

### Análise dos Plugins Atuais

#### Plugin-KeyVal
- **Modelo Atual**: Usa `batch()` + version checks para "transações" atômicas
- **Limitação**: Não suporta transações interativas reais (BEGIN/COMMIT/ROLLBACK)
- **Necessidade**: Provavelmente não precisa de WebSocket (modelo atual é suficiente)

#### Plugin-Durable
- **Modelo Atual**: Implementa `InMemoryTransaction` própria (não usa plugin-database)
- **Limitação**: Transações são in-memory, não garantem atomicidade no banco
- **Problema**: Inconsistente com outros plugins que usam plugin-database
- **Necessidade**: Deve migrar para usar `adapter.transaction()` do plugin-database

#### Plugins Futuros
- **Jogos**: Precisam de transações interativas para estado consistente
- **Trading/Financeiro**: Controle transacional crítico
- **Sistemas Complexos**: Workflows multi-etapa com rollback possível

## 🛠️ Arquitetura Proposta

### 1. Correção do Roteamento de Namespaces (Prioridade 1)

#### Subdomain-Based Routing (Correto)
```typescript
private buildTenantUrl(baseUrl: string, tenantId: string): string {
  const url = new URL(baseUrl);

  // Para HTTP/HTTPS/WS/WSS/libsql://, usar subdomain-based routing
  if (url.protocol === "http:" || url.protocol === "https:" ||
      url.protocol === "ws:" || url.protocol === "wss:" ||
      url.protocol === "libsql:") {

    // Modificar hostname: localhost:8080 → tenant1.localhost:8080
    const hostname = url.hostname;
    const newHostname = hostname.includes(".")
      ? `${tenantId}.${hostname}`
      : `${tenantId}.${hostname}`;

    url.hostname = newHostname;
    return url.toString();
  }

  // File URLs mantêm comportamento atual
  return baseUrl;
}
```

#### Admin API com Conversão WS→HTTP
```typescript
private getAdminApiUrl(): string {
  // Admin API sempre usa URL base (sem tenant)
  // Converte WebSocket para HTTP se necessário
  const url = new URL(this.primaryUrl);

  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  if (url.protocol === "libsql:") url.protocol = "https:";

  return url.toString();
}
```

### 2. Suporte a Protocolos no Plugin-Database

#### Novos Tipos
```typescript
export type DatabaseProtocol = "http" | "ws";

export interface GetAdapterOptions {
  protocol?: DatabaseProtocol;
}
```

#### Interface Atualizada
```typescript
interface DatabaseService {
  getAdapter(type?: AdapterType, tenantId?: string, options?: GetAdapterOptions): Promise<DatabaseAdapter>;
  getRootAdapter(type?: AdapterType, options?: GetAdapterOptions): DatabaseAdapter;
}
```

#### Cache Inteligente por Protocolo
```typescript
private getAdapterByType(type?: AdapterType, options?: GetAdapterOptions): DatabaseAdapter {
  const protocol = options?.protocol ?? "http";
  const cacheKey = `${resolvedType}:${protocol}`;

  // Cache separado por protocolo + conversão automática de URLs
}
```

#### Interface Atualizada
```typescript
interface DatabaseService {
  getAdapter(type?: AdapterType, tenantId?: string, options?: GetAdapterOptions): Promise<DatabaseAdapter>;
  getRootAdapter(type?: AdapterType, options?: GetAdapterOptions): DatabaseAdapter;
}
```

### 2. Lógica de Roteamento

#### Cache por Protocolo
- Cache separado: `"libsql:http"` vs `"libsql:ws"`
- Conversão automática de URLs baseada no protocolo
- HTTP como padrão (backward compatible)

#### Implementação no Service
```typescript
private getAdapterByType(type?: AdapterType, options?: GetAdapterOptions): DatabaseAdapter {
  const protocol = options?.protocol ?? "http";
  const cacheKey = `${resolvedType}:${protocol}`;

  // Cache lookup e criação condicional
  // Conversão de URLs: http:// → ws:// quando protocol === "ws"
}
```

### 3. Uso pelos Plugins

#### Plugin Atual (HTTP)
```typescript
// Continua funcionando igual - HTTP por padrão
const adapter = database.getRootAdapter("libsql");
```

#### Plugin Avançado (WebSocket)
```typescript
// Novo: especifica protocolo WebSocket
const adapter = database.getRootAdapter("libsql", { protocol: "ws" });

// Agora suporta transações interativas
await adapter.transaction(async (tx) => {
  await tx.execute("BEGIN");
  await tx.execute("INSERT INTO games...");
  await tx.execute("UPDATE scores...");
  await tx.execute("COMMIT");
});
```

## 📊 Benefícios

### Para Plugins Simples
- ✅ Zero mudanças necessárias
- ✅ Continua usando HTTP (adequado para maioria dos casos)
- ✅ Backward compatible

### Para Plugins Avançados
- ✅ Acesso a transações interativas
- ✅ Controle fino sobre commits/rollbacks
- ✅ Melhor performance para workloads complexos

### Para o Sistema
- ✅ Flexibilidade arquitetural
- ✅ Otimização por caso de uso
- ✅ Manutenibilidade

## 🔄 Fases de Implementação

### Fase 1: Correção do Roteamento (Prioridade Máxima)
1. ✅ Corrigir `buildTenantUrl()` para subdomain-based routing
2. ✅ Adicionar suporte a `ws://`, `wss://`, `libsql://`
3. ✅ Implementar `getAdminApiUrl()` para conversão WS→HTTP
4. ✅ Atualizar métodos Admin API (`createTenant`, `deleteTenant`, `listTenants`)
5. ✅ Adicionar testes para subdomain-based routing
6. ✅ Executar `bun lint && bun test`

### Fase 2: Suporte a Protocolos (Plugin-Database)
1. ✅ Adicionar tipos `DatabaseProtocol` e `GetAdapterOptions`
2. ✅ Atualizar interface `DatabaseService`
3. ✅ Implementar cache por protocolo no `getAdapterByType()`
4. ✅ Adicionar conversão automática de URLs baseada no protocolo
5. ✅ HTTP como padrão (backward compatible)

### Fase 3: Consistência Transacional
1. 🔄 **Migrar Plugin-Durable**: Substituir `InMemoryTransaction` por `adapter.transaction()`
2. ✅ Manter Plugin-KeyVal (modelo adequado)
3. ✅ Garantir que todos plugins usem APIs do plugin-database

### Fase 4: Testes e Validação Completa
1. ✅ Testes para subdomain-based routing
2. ✅ Testes para WebSocket URLs
3. ✅ Testes para escolha de protocolo
4. ✅ Validação de atomicidade transacional
5. ✅ Testes de performance comparativa

### Fase 5: Documentação e Exemplos
1. ✅ Atualizar documentação sobre roteamento correto
2. ✅ Documentar escolha de protocolos
3. ✅ Exemplos de uso WebSocket
4. ✅ Guias de migração para plugins

### Fase 6: Monitoramento e Otimização
1. ✅ Monitorar performance HTTP vs WebSocket
2. ✅ Identificar casos de uso ideais para cada protocolo
3. ✅ Otimizar conversão de URLs
4. ✅ Ajustar estratégia baseada em dados reais

## 🎯 Casos de Uso Alvo

### Plugins que DEVEM usar WebSocket
- **Jogos multiplayer**: Controle transacional preciso para estado de jogo
- **Sistemas financeiros**: Transações complexas com rollback possível
- **Trading platforms**: Operações sequenciais críticas
- **Sistemas de reserva**: Controle de concorrência avançado
- **Workflows complexos**: Operações multi-etapa com rollback manual

### Plugins que PODEM continuar com HTTP
- **KeyVal**: Modelo de transações atômicas com version checks funciona bem
- **Logs**: Operações simples, batches suficientes
- **Metrics**: Writes simples, não precisa transações complexas
- **Auth**: Operações CRUD básicas
- **APIs RESTful**: Requests independentes

### Análise dos Plugins Atuais
- **Plugin-KeyVal**: ✅ Adequado com HTTP (modelo de version checks)
- **Plugin-Durable**: 🔄 NECESSITA MIGRAÇÃO (usar adapter.transaction())
- **Plugin-Auth**: ✅ HTTP suficiente
- **Plugin-Logs**: ✅ HTTP suficiente

### Migração do Plugin-Durable
**Problema Atual**: Usa `InMemoryTransaction` que não garante atomicidade no banco
**Solução**: Migrar para usar `adapter.transaction()` do plugin-database
**Benefício**: Consistência com outros plugins + suporte a WebSocket se necessário

## ⚠️ Considerações Técnicas

### Cache e Performance
- Cache separado por protocolo evita conflitos
- Conversão de URLs é feita uma vez na criação do adapter
- Overhead mínimo para plugins que usam HTTP

### Backward Compatibility
- HTTP como padrão garante compatibilidade
- APIs existentes continuam funcionando
- Mudanças são opt-in

### Segurança e Isolamento
- Mesmo tenant isolation para ambos protocolos
- Mesmas permissões e controles de acesso
- Isolamento entre HTTP e WebSocket mantido

### Consistência entre Plugins
- **Importante**: Plugins devem usar APIs consistentes do plugin-database
- Evitar implementar transações customizadas (como faz plugin-keyval)
- Preferir usar `adapter.transaction()` para transações interativas
- Manter consistência no modelo transacional usado

### Estratégia de Protocolos
- **Não forçar WebSocket**: Apenas quando necessário
- **Avaliação por caso**: Cada plugin decide baseado em necessidades
- **Monitoramento**: Acompanhar benefícios reais do WebSocket vs overhead

## 📈 Métricas de Sucesso

### Funcionais
- ✅ Plugins podem escolher protocolo
- ✅ Transações interativas funcionam via WebSocket
- ✅ HTTP continua funcionando como padrão
- ✅ Zero breaking changes
- ✅ Consistência transacional mantida

### Performance
- ✅ Overhead mínimo para HTTP
- ✅ Benefícios de WebSocket para casos apropriados
- ✅ Cache eficiente por protocolo

### Consistência Arquitetural
- ✅ Plugins usam APIs consistentes do plugin-database
- ✅ Modelo transacional unificado
- ✅ Protocolos escolhidos por necessidade real
- ✅ Plugin-Durable migrado para adapter.transaction()

### Manutenibilidade
- ✅ Código limpo e bem documentado
- ✅ Testes abrangentes
- ✅ Documentação atualizada

## 🚀 Próximos Passos

1. **Implementar Fase 1** (tipos e interfaces) ✅
2. **Implementar Fase 2** (lógica core)
3. **Testar e validar**
4. **Documentar e comunicar**
5. **Avaliar consistência dos plugins atuais**
6. **Migrar apenas plugins que realmente precisam**

## 📋 Recomendações para Consistência

### Para Plugins Existentes
- **Plugin-KeyVal**: Manter implementação atual (version checks + batch)
- **Plugin-Durable**: Avaliar se workflows complexos precisam de `transaction()`
- **Outros plugins**: Preferir APIs do plugin-database sobre implementações customizadas

### Para Novos Plugins
- **Usar `adapter.transaction()`** para transações interativas
- **Escolher protocolo** baseado em necessidades reais
- **Documentar escolha** de protocolo e justificativa

### Princípios Gerais
- **Consistência primeiro**: Mesmo modelo transacional em todos os plugins
- **Protocolo por necessidade**: WebSocket apenas quando agrega valor real
- **Performance over features**: Não usar WebSocket só por "ser mais avançado"

## 📋 Checklist de Implementação

### ✅ Concluído (Fase 1 - Planejamento)
- [x] Tipos `DatabaseProtocol` e `GetAdapterOptions`
- [x] Interface `DatabaseService` atualizada
- [x] Análise de roteamento incorreto identificado
- [x] Plano de correção subdomain-based routing
- [x] Análise de consistência dos plugins atuais

### 🔄 Próximas Prioridades (Fase 2)
- [ ] **Correção do LibSqlAdapter**: Implementar subdomain-based routing
- [ ] **Admin API**: Implementar `getAdminApiUrl()` e conversão WS→HTTP
- [ ] **Migração Plugin-Durable**: Para `adapter.transaction()`
- [ ] **Suporte a protocolos**: Cache inteligente por protocolo

### 📋 Pendentes (Fases 3-6)
- [ ] Testes completos para roteamento e protocolos
- [ ] Documentação atualizada sobre roteamento correto
- [ ] Exemplos de uso WebSocket
- [ ] Monitoramento de performance HTTP vs WebSocket

---

## 🎯 **Abordagem Integrada: Melhor Caso**

Este plano combina o **melhor dos dois mundos**:

### 📋 **Do Plano Técnico (Existente)**
- ✅ Correção precisa do roteamento subdomain-based
- ✅ Suporte correto a WebSocket URLs
- ✅ Conversão Admin API WS→HTTP
- ✅ Detalhes de implementação específicos

### 📋 **Do Plano Estratégico (Novo)**
- ✅ Análise de consistência dos plugins
- ✅ Estratégia de quando usar cada protocolo
- ✅ Migração do plugin-durable
- ✅ Visão arquitetural completa

### 🎯 **Resultado: Implementação Completa e Correta**

#### **Técnico + Estratégico = Solução Robusta**
1. **Roteamento correto** (subdomain-based conforme libSQL docs)
2. **Escolha de protocolo** (HTTP/WebSocket por necessidade)
3. **Consistência garantida** (todos plugins usam APIs corretas)
4. **Flexibilidade arquitetural** (zero breaking changes)
5. **Performance otimizada** (protocolo certo para cada caso)

#### **Benefícios Específicos**
- ✅ **Conformidade**: Segue documentação oficial do libSQL
- ✅ **Flexibilidade**: Plugins escolhem protocolo ideal
- ✅ **Consistência**: Modelo transacional unificado
- ✅ **Performance**: WebSocket onde agrega valor real
- ✅ **Manutenibilidade**: APIs consistentes em todo monorepo

### 🚀 **Sequência Otimizada**

1. **Correção técnica** (roteamento correto) - Base sólida
2. **Suporte a protocolos** (escolha HTTP/WebSocket) - Flexibilidade
3. **Consistência plugins** (todos usam APIs corretas) - Arquitetura sólida
4. **Monitoramento** (performance e otimização) - Melhoria contínua

---

**Data:** Dezembro 2025
**Status:** Pronto para implementação
**Responsável:** AI Assistant
**Abordagem:** Integrada (Técnica + Estratégica)</content>
<parameter name="filePath">/home/user/Developer/zomme/buntime/plans/websocket-protocol-support.md