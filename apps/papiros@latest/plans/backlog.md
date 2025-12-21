# Backlog - Docs App

## MVP (v1.0.0)

### Funcionalidades Core

- [x] API para listar projetos configurados
- [x] API para buscar arvore de arquivos .adoc do GitLab
- [x] API para buscar conteudo de arquivos especificos
- [x] API para buscar README.adoc principal
- [x] API para buscar release notes
- [x] Cache de respostas do GitLab (15 min TTL)
- [x] Renderizacao de AsciiDoc com asciidoctor.js
- [x] Sidebar com navegacao de projetos
- [x] Estilos para conteudo AsciiDoc (tabelas, code blocks, admonitions)

### Pendentes MVP

- [ ] Tratamento de includes
- [ ] Suporte a imagens referenciadas nos docs
- [ ] Dark mode toggle
- [ ] Busca de texto no conteudo
- [ ] Loading states melhorados
- [ ] Error boundaries no React
- [ ] Favicon SVG

## v1.1.0 - Melhorias de UX

### Navegacao

- [ ] Breadcrumbs para navegacao
- [ ] Deep linking (URLs para cada pagina)
- [ ] Historico de navegacao (voltar/avancar)
- [ ] Anchor links para secoes (TOC funcional)
- [ ] Scroll to top button

### Busca

- [ ] Busca full-text no conteudo
- [ ] Busca por nome de arquivo
- [ ] Highlight de termos encontrados
- [ ] Atalho de teclado (Cmd+K / Ctrl+K)

### Visual

- [ ] Dark mode com persistencia
- [ ] Responsividade mobile
- [ ] Skeleton loading
- [ ] Print-friendly styles
- [ ] Syntax highlighting para code blocks

## v1.2.0 - Funcionalidades Avancadas

### Conteudo

- [ ] Suporte a diagramas Mermaid
- [ ] Renderizacao de PlantUML
- [ ] Preview de imagens inline
- [ ] Copy button em code blocks
- [ ] Expand/collapse para secoes longas

### Integracao

- [ ] Webhook para invalidar cache quando ha push
- [ ] Suporte a multiplos branches (main, develop)
- [ ] Suporte a tags/versoes
- [ ] API para listar releases do GitLab
- [ ] Comparacao de versoes

### Performance

- [ ] Service Worker para cache offline
- [ ] Lazy loading de componentes
- [ ] Virtualizacao para listas longas
- [ ] Pre-fetch de paginas adjacentes

## Backlog Tecnico

### Testes

- [ ] Testes unitarios para API (server/api.ts)
- [ ] Testes de integracao com GitLab mock
- [ ] Testes de componentes React
- [ ] Testes E2E com Playwright
- [ ] Coverage minimo de 80%

### Infraestrutura

- [ ] Dockerfile para deploy
- [ ] CI/CD pipeline
- [ ] Health check endpoint
- [ ] Metricas Prometheus
- [ ] Logs estruturados

### Codigo

- [ ] Extrair tipos para arquivo separado
- [ ] Criar hooks customizados (useProject, useDocument)
- [ ] Adicionar error boundaries
- [ ] Melhorar tipagem da API do GitLab

## Debitos Tecnicos

- [ ] Adicionar .dirinfo nos diretorios
- [ ] Configurar biome/eslint
- [ ] Adicionar testes basicos
- [ ] Validar resposta da API do GitLab
