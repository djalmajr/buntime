# Browser smoke test - runtime local

Data: 2026-05-01

Ambiente:
- Branch: `runtime-performance-resilience`
- Host runtime: `https://buntime.home/`
- Deploy testado: imagem `ghcr.io/zommehq/buntime:runtime-performance-resilience`
- Cluster: k3s local via Rancher/Traefik com TLS self-signed
- Navegador: contexto Playwright isolado com `ignoreHTTPSErrors: true`

## Resultado geral

| Alvo | Resultado | Observacao |
|------|-----------|------------|
| `https://buntime.home/` | 200 | Shell carrega; area protegida mostra bloqueio por falta de sessao |
| `https://gitlab.example.com/` | 200 | Tela de login do GitLab carregou |
| `https://rancher.home/` | 200 | Redireciona para `/dashboard/`, mas ficou no spinner no smoke visual |

## Runtime Buntime

Validacoes feitas pelo navegador:

| Recurso | Status | Resultado |
|---------|--------|-----------|
| `/` | 200 | Title `Platform`; texto visivel: `You do not have permission to access this environment.` |
| `/_/api/health/live` | 200 | `{ ok: true, status: "live", version: "1.1.0" }` |
| `/_/api/health/ready` | 200 | `{ ok: true, status: "ready", version: "1.1.0" }` |
| `/.well-known/buntime` | 200 | `{ api: "/_/api", version: "1.1.0" }` |
| `/_/api/plugins/loaded` | 200 | 6 plugins carregados |
| `/deployments/api/apps` | 401 | Esperado sem token de autenticacao |

Plugins reportados por `/_/api/plugins/loaded`:
- `@buntime/plugin-deployments` em `/deployments`
- `@buntime/plugin-database` em `/database`
- `@buntime/plugin-keyval` em `/keyval`
- `@buntime/plugin-proxy` em `/redirects`
- `@buntime/plugin-gateway` em `/gateway`
- `@scope/plugin-auth-token` em `/auth-token`

Console do navegador:
- `401` em `/api/config/keycloak`
- `401` em `/deployments/api/apps`
- Warning visual: icone `mdi-cloud-outline` nao encontrado no registry

Interpretacao:
- O deploy, Ingress, assets do shell, health checks e descoberta de plugins estao funcionais.
- A UI principal nao foi exercitada alem da tela de bloqueio porque o runtime esta protegido pelo `@scope/plugin-auth-token`.
- Para testar o fluxo autenticado no browser, e necessario usar um token legitimo via cookie `HYPER-AUTH-TOKEN` ou header `Authorization: Bearer`.
- Nao foi usado JWT sintetico para contornar a protecao de acesso. Se for necessario smoke test autenticado local, registrar permissao explicita e usar token de teste isolado, sem dados reais.

## Evidencias locais

Screenshots gerados:
- `apps/runtime/plans/browser-smoke-buntime.home.png`
- `apps/runtime/plans/browser-smoke-buntime-home.png`
- `apps/runtime/plans/browser-smoke-gitlab.example.com.png`
- `apps/runtime/plans/browser-smoke-rancher.home.png`

## Proximos testes recomendados

- Configurar um token de smoke test legitimo para `@scope/plugin-auth-token` e repetir a navegacao autenticada.
- Confiar a CA local do cluster no ambiente de testes do navegador, para reduzir a dependencia de `ignoreHTTPSErrors`.
- Investigar o spinner do Rancher em uma sessao autorizada, caso o objetivo seja validar a UI administrativa e nao apenas disponibilidade HTTP.
- Corrigir ou mapear o icone `mdi-cloud-outline` usado pelo shell/plugin para eliminar warning visual.
