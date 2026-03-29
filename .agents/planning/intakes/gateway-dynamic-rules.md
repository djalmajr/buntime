# Gateway: Regras dinâmicas de acesso

## Problema
O gateway atualmente tem regras estáticas de acesso (publicRoutes dos manifests dos apps). Não há interface para regras dinâmicas como:
- Bloqueio de paths por padrão (ex: `/internal/*`)
- Rate limiting por rota
- Rewrite rules
- IP allowlists

## Necessidade
Interface no gateway para regras dinâmicas de acesso, similar ao que o plugin-proxy já faz com regras de redirect. Permitir que plugins registrem regras de acesso em runtime.

## Contexto
Hoje o auth-token verifica publicRoutes (do manifest e do proxy). O gateway poderia centralizar todas as regras de acesso em vez de cada plugin implementar sua própria lógica.

## Abordagem sugerida
- O gateway expõe uma interface `provides()` para registrar regras de acesso
- Plugins podem registrar regras de bloqueio/permissão no `onInit`
- Regras podem ser persistidas no KeyVal (como o proxy faz)
- UI no cpanel para visualizar/editar regras

## Referências
- `plugin-gateway/plugin.ts`
- `plugin-proxy/server/services.ts` (modelo de regras dinâmicas)
- `plugin-auth-token/plugin.ts` (verifica publicRoutes)
