# Gateway: Bloqueio de rotas internas

## Problema
Endpoints `/internal/*` nos workers são acessíveis por browsers. Não há mecanismo no gateway para bloquear paths específicos para requests externos.

## Necessidade
O gateway deve:
1. Bloquear requests externos para paths que contenham `/internal/` (retornar 403)
2. Remover headers como `X-Internal` de requests externos (para que não sejam spoofados)
3. Permitir que plugins internos (backend-to-backend) acessem esses paths normalmente

## Contexto
O plugin-resource-tenant precisa chamar endpoints do applications que retornam dados sensíveis (credenciais de banco descriptografadas). Esses endpoints devem ser acessíveis apenas por plugins internos do Buntime, nunca por browsers.

## Abordagem sugerida
- Regra no gateway: paths com `/internal/` são bloqueados para requests que vêm de fora
- O gateway strip o header `X-Internal` de requests externos
- Plugins internos adicionam `X-Internal: true` nas chamadas backend-to-backend
- Configurável via manifest ou config do gateway

## Referências
- `plugin-gateway/plugin.ts`
- `plugin-auth-token/plugin.ts` (verifica publicRoutes)
- `plugin-resource-tenant/server/service.ts` (chama endpoints internos)
