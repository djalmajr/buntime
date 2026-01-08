# Roadmap: plugin-streams

Baseado no protocolo [Durable Streams](https://github.com/durable-streams/durable-streams) da Electric SQL.

## Motivacao

- **Problema**: SSE/WebSocket sao frageis - conexao cai, dados perdidos
- **Solucao**: Offset-based resumability - cliente reconecta e continua de onde parou
- **Beneficio**: CDN-friendly, pode fazer fan-out para milhares de clientes

## Casos de Uso

| Caso | Atual | Com plugin-streams |
|------|-------|-------------------|
| `kv.watch()` | SSE simples | Resumivel via offset |
| `kv.listenQueue()` | SSE/polling | Delivery garantido |
| AI/LLM streaming | Perde tokens se reconectar | Continua de onde parou |
| Real-time sync | Sem garantias | Exactly-once delivery |

## Arquitetura

```
+---------------------------------------------------------------------+
|  Camada de Queries (Request/Response)                               |
|  +----------------------------------------------------------------+ |
|  |  HRANA Protocol (HTTP/WebSocket)                               | |
|  |  - execute, batch, transactions                                | |
|  |  - Para: CRUD, queries ad-hoc, ORMs                            | |
|  +----------------------------------------------------------------+ |
+---------------------------------------------------------------------+

+---------------------------------------------------------------------+
|  Camada de Streaming (Pub/Sub Duravel)                              |
|  +----------------------------------------------------------------+ |
|  |  Durable Streams Protocol                                      | |
|  |  - watch, queues, real-time sync                               | |
|  |  - Para: eventos, notificacoes, sync de estado                 | |
|  +----------------------------------------------------------------+ |
+---------------------------------------------------------------------+
```

## API Proposta

```typescript
// Criar stream
const stream = await streams.create("user-events");

// Append (retorna offset)
const offset = await stream.append({ type: "user.created", data: {...} });

// Read desde offset
for await (const msg of stream.read({ after: savedOffset })) {
  process(msg);
  savedOffset = msg.offset;
}

// Live tail (SSE/WebSocket com resumability)
const handle = stream.tail({ after: savedOffset }, (msg) => {
  process(msg);
  localStorage.setItem("offset", msg.offset);
});
```

## Integracao com plugin-keyval

```typescript
// Antes (fragil)
kv.watch(["users"], callback);

// Depois (duravel)
kv.watch(["users"], callback, {
  durable: true,
  resumeFrom: localStorage.getItem("users-offset")
});
```

## Timeline

| Fase | Quando | Entregavel |
|------|--------|------------|
| HRANA Completo | Q4 2024 | WebSocket, Prepared Statements, Batch Conditions |
| Testes e Validacao | Q4 2024 | skedly@latest funcionando |
| plugin-streams MVP | Q1 2025 | Create, Append, Read, Tail |
| Integracao keyval | Q2 2025 | watch() duravel |
| CDN/Fan-out | Q3 2025 | Caching, escalabilidade |

## Referencias

- [Durable Streams Protocol](https://github.com/durable-streams/durable-streams)
- [Electric SQL Blog - Announcing Durable Streams](https://electric-sql.com/blog/2025/12/09/announcing-durable-streams)
- [@durable-streams/client](https://www.npmjs.com/package/@durable-streams/client)

## Features Detalhadas

### MVP (Q1 2025)

1. **Stream Creation**
   - `POST /streams/api/v1/streams` - Criar stream
   - Metadata: name, retention policy, max size

2. **Append**
   - `POST /streams/api/v1/streams/:name/append` - Adicionar mensagem
   - Retorna offset monotonicamente crescente
   - Suporta batching para alta performance

3. **Read**
   - `GET /streams/api/v1/streams/:name/read?after=:offset` - Ler desde offset
   - Paginacao automatica
   - Formato JSON ou raw bytes

4. **Tail (Live)**
   - `GET /streams/api/v1/streams/:name/tail?after=:offset` - SSE com resumability
   - Long-poll fallback
   - Heartbeat para manter conexao

### Integracao KeyVal (Q2 2025)

1. **Watch Duravel**
   - Cada mudanca no KV gera evento no stream
   - Cliente pode resumir de qualquer offset
   - Garante exactly-once delivery

2. **Queue Duravel**
   - Mensagens da queue persistem no stream
   - Consumer pode replay desde qualquer ponto
   - Dead letter queue com offset tracking

### CDN/Fan-out (Q3 2025)

1. **Offset-based URLs**
   - `/streams/:name/read?after=abc123` e cacheable
   - CDN pode servir mesma resposta para multiplos clientes

2. **Edge Caching**
   - Streams populares cacheados no edge
   - Reduces load no origin server

3. **Multi-region Replication**
   - Streams replicados entre regioes
   - Leitura local, escrita global
