# Proximos Passos - Docs App

## Imediato (Esta Semana)

### 1. Completar MVP

1. **Testar build e execucao**
   - Rodar `bun install` no monorepo
   - Rodar `bun run build` no app
   - Testar com buntime localmente
   - Validar renderizacao de AsciiDoc

2. **Configurar ambiente**
   - Criar token de acesso ao GitLab (read_repository)
   - Configurar variaveis de ambiente
   - Testar conexao com GitLab Cloud4Biz

3. **Ajustes de UI**
   - Adicionar favicon
   - Melhorar loading states
   - Testar responsividade basica

### 2. Validar com Projetos Reais

1. **example-spa**
   - Testar carregamento do README.adoc
   - Testar release-notes.adoc
   - Verificar renderizacao de tabelas

2. **lowcode-studio**
   - Testar estrutura en-us/pt-br
   - Verificar includes

3. **Documentar problemas encontrados**
   - Criar issues no backlog

## Curto Prazo (2 Semanas)

### 1. Deep Linking

- Implementar React Router ou TanStack Router
- URLs como `/docs/example-spa/release-notes`
- Permitir compartilhar links diretos

### 2. Busca Basica

- Busca por nome de arquivo
- Filtro na sidebar
- Atalho Cmd+K

### 3. Dark Mode

- Toggle no header
- Persistir preferencia
- Usar prefers-color-scheme

## Medio Prazo (1 Mes)

### 1. Integracao com Run2Biz

- Definir onde o app sera hospedado
- Configurar DNS (docs.team.com ou similar)
- Integrar com autenticacao existente (opcional)

### 2. CI/CD

- Pipeline para build automatico
- Deploy em staging
- Testes automatizados

### 3. Webhook de Invalidacao

- Endpoint para receber webhooks do GitLab
- Invalidar cache quando houver push
- Notificar usuarios de atualizacoes

## Decisoes Pendentes

1. **Hospedagem**: Onde o app vai rodar?
   - Edge Runtime existente?
   - Servidor dedicado?
   - GitLab Pages?

2. **Autenticacao**: Precisa de login?
   - Publico para todos?
   - Restrito a usuarios autenticados?
   - Baseado em IP/VPN?

3. **Escopo de Projetos**: Quais projetos incluir?
   - Apenas hyper/*?
   - Todos os projetos Run2Biz?
   - Configuravel via API?

4. **Idioma**: Suporte multi-idioma?
   - Apenas pt-br?
   - pt-br + en-us?
   - Detectar automaticamente?

## Metricas de Sucesso

- [ ] App funcionando em producao
- [ ] Pelo menos 5 projetos com docs acessiveis
- [ ] Tempo de carregamento < 2s
- [ ] Zero erros de renderizacao AsciiDoc
- [ ] Feedback positivo da equipe
