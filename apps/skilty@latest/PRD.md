# Skilty — Product Requirements Document

**Versão:** 1.0
**Data:** Dezembro 2025
**Autor:** Djalma Jr
**Status:** Draft

---

## 1. Visão Geral

### 1.1 O que é o Skilty?

Skilty é uma plataforma de desenvolvimento de carreira para programadores que combina três elementos: aprendizado gamificado através de árvores de skills (como em jogos RPG), validação de competências através de projetos reais, e conexão com oportunidades de trabalho.

Diferente de plataformas de cursos tradicionais, o Skilty não vende certificados — vende **comprovação de habilidades**. Cada skill dominada é evidenciada por código real, auditável, produzido pelo desenvolvedor.

### 1.2 Por que o Skilty existe?

O mercado de tecnologia enfrenta um problema de confiança. Empresas não sabem se candidatos realmente sabem fazer o que dizem. Desenvolvedores não sabem o que precisam aprender para avançar. Bootcamps vendem certificados genéricos que não comprovam nada.

O Skilty resolve isso criando um sistema onde:

- Devs têm um **mapa claro** do júnior ao arquiteto de soluções
- Empresas têm acesso a **candidatos com skills verificadas por projetos reais**
- A validação é **granular** (não "formou no bootcamp X", mas "domina OAuth, SQL avançado, e CI/CD")

### 1.3 Conexão com o ecossistema Zomme

O Skilty faz parte de uma estratégia maior. Os projetos de aprendizado (bosses) ensinam conceitos aplicados a domínios genéricos, enquanto os produtos reais do ecossistema Zomme (Skedly, Kashes, Kliente, etc.) servem como cases avançados e destino para os melhores alunos contribuírem.

```
┌─────────────────────────────────────────────────────────┐
│                      SKILTY                             │
│              (aprendizado + validação)                  │
│                         │                               │
│                         ▼                               │
│   ┌─────────────────────────────────────────────────┐   │
│   │           MELHORES ALUNOS                       │   │
│   │    (contribuem para produtos reais)             │   │
│   └─────────────────────┬───────────────────────────┘   │
│                         │                               │
│         ┌───────────────┼───────────────┐               │
│         ▼               ▼               ▼               │
│    ┌─────────┐    ┌─────────┐    ┌─────────┐            │
│    │ SKEDLY  │    │ KASHES  │    │ KLIENTE │            │
│    └─────────┘    └─────────┘    └─────────┘            │
│                                                         │
│    (micro-SaaS para MEI/informal brasileiro)            │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Público-Alvo

### 2.1 Desenvolvedores (lado da oferta)

**Primário: Desenvolvedores Júnior/Pleno brasileiros**

- Idade: 18-35 anos
- Momento: início ou meio de carreira, buscando direção
- Dor: não sabem o que estudar, certificados não valem nada, difícil provar competência
- Desejo: mapa claro de evolução, portfólio que impressiona, oportunidades melhores

**Secundário: Desenvolvedores em transição de carreira**

- Vindo de outras áreas (engenharia, design, administração)
- Fizeram bootcamp mas não conseguem emprego
- Precisam de validação externa de suas habilidades

**Terciário: Desenvolvedores experientes**

- Querem solidificar conhecimento
- Buscam visibilidade como mentores/referências
- Interessados em contribuir para projetos reais

### 2.2 Empresas (lado da demanda)

**Primário: Startups e software houses brasileiras**

- 10-200 funcionários
- Contratam 2-20 devs por ano
- Dor: processo seletivo caro e ineficiente, contratações erradas
- Desejo: pool pré-validado, menor risco, menos tempo de triagem

**Secundário: Empresas de médio porte com área de tecnologia**

- Empresas tradicionais digitalizando
- Precisam de devs mas não sabem avaliar
- Confiam mais em validação externa

---

## 3. Proposta de Valor

### 3.1 Para Desenvolvedores

| Benefício | Como o Skilty entrega |
|-----------|----------------------|
| Direção clara | Árvore de skills visual do júnior ao arquiteto |
| Aprendizado prático | Bosses são projetos reais, não exercícios artificiais |
| Portfólio que comprova | Código público, auditável, com métricas |
| Oportunidades | Empresas buscam por skills específicas |
| Comunidade | Peer review, mentoria, colaboração |

### 3.2 Para Empresas

| Benefício | Como o Skilty entrega |
|-----------|----------------------|
| Candidatos pré-validados | Skills comprovadas por projetos, não por CV |
| Busca granular | "Node.js nível 3 + SQL nível 2 + disponível" |
| Menor risco | Código real para avaliar antes de entrevistar |
| Menor custo | Sem headhunter, triagem já feita |
| Verificação | Defesa oral opcional para validar autoria |

---

## 4. Modelo de Negócio

### 4.1 Fontes de Receita

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   GRATUITO (devs)                                       │
│   └─ Todo conteúdo educacional                          │
│   └─ Progressão orgânica ilimitada                      │
│   └─ Perfil público com skills                          │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   PREMIUM DEV (R$29-49/mês)                             │
│   └─ Revisão de código por seniores                     │
│   └─ Mentoria 1:1                                       │
│   └─ Fast-track (prioridade na fila de review)          │
│   └─ Badges premium no perfil                           │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   EMPRESAS (R$299-999/mês)                              │
│   └─ Acesso ao pool de candidatos                       │
│   └─ Filtros avançados por skill/nível                  │
│   └─ Contato direto com candidatos                      │
│   └─ Dashboard de pipeline                              │
│   └─ Verificação de autoria (defesa oral)               │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ENTERPRISE / PATROCÍNIO                               │
│   └─ Empresa patrocina uma trilha                       │
│   └─ Logo + acesso prioritário a quem completar         │
│   └─ Devs internos fazem reviews (treinamento)          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Unit Economics (projeção inicial)

| Métrica | Valor |
|---------|-------|
| CAC Dev (orgânico) | R$0-10 |
| CAC Empresa | R$200-500 |
| LTV Dev Premium | R$300-600 (12 meses) |
| LTV Empresa | R$3.600-12.000 (12 meses) |
| Margem bruta | 80%+ (infra mínima) |

---

## 5. Arquitetura de Produto

### 5.1 Conceitos Centrais

**Skill**
Unidade atômica de conhecimento. Exemplos: "HTTP Basics", "SQL Joins", "OAuth 2.0". Uma skill contém: explicação conceitual, recursos externos, exercícios práticos, critérios de domínio.

**Árvore de Skills (Skill Tree)**
Grafo direcionado de skills organizadas por domínio (Backend, Frontend, DevOps, etc). Mostra dependências e progressão. Cada nó é uma skill, arestas indicam pré-requisitos.

**Boss**
Projeto prático que valida um conjunto de skills. Varia em tamanho: Mini-boss (1-2 skills), Boss (3-5 skills), Raid Boss (múltiplas árvores). Exemplos: "API REST com auth", "Dashboard com gráficos", "Sistema completo com deploy".

**Trilha (Path)**
Sequência recomendada de skills + bosses para alcançar um objetivo. Exemplo: "Backend Node.js: Júnior → Pleno".

**Nível de Skill**
Escala de 1-5 indicando profundidade. Nível 1 é conceito básico, nível 5 é domínio avançado. Empresas buscam por níveis específicos.

### 5.2 Fluxo do Desenvolvedor

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  1. DESCOBERTA                                               │
│     └─ Dev encontra Skilty (conteúdo, indicação, busca)      │
│     └─ Cria conta (GitHub OAuth)                             │
│     └─ Explora árvore de skills                              │
│                                                              │
│  2. APRENDIZADO                                              │
│     └─ Escolhe uma trilha ou skill específica                │
│     └─ Consome conteúdo (texto, diagramas, código)           │
│     └─ Pratica com exercícios                                │
│                                                              │
│  3. VALIDAÇÃO                                                │
│     └─ Enfrenta um Boss (projeto prático)                    │
│     └─ Submete código (link GitHub)                          │
│     └─ Validação automatizada (testes, lint, coverage)       │
│     └─ Peer review (opcional) ou review de senior (premium)  │
│     └─ Grava defesa oral (3-5 min explicando decisões)       │
│                                                              │
│  4. PROGRESSÃO                                               │
│     └─ Skill marcada como dominada                           │
│     └─ Nível atualizado no perfil                            │
│     └─ Novas skills desbloqueadas                            │
│     └─ Aparece no pool para empresas                         │
│                                                              │
│  5. OPORTUNIDADE                                             │
│     └─ Empresa busca por skills específicas                  │
│     └─ Dev aparece nos resultados                            │
│     └─ Empresa visualiza código e defesa oral                │
│     └─ Contato direto ou processo seletivo                   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 5.3 Fluxo da Empresa

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  1. ONBOARDING                                               │
│     └─ Empresa cria conta                                    │
│     └─ Escolhe plano                                         │
│     └─ Define perfil de busca (skills desejadas)             │
│                                                              │
│  2. BUSCA                                                    │
│     └─ Filtra por skills + níveis                            │
│     └─ Filtra por disponibilidade, localização               │
│     └─ Visualiza lista de candidatos                         │
│                                                              │
│  3. AVALIAÇÃO                                                │
│     └─ Clica no perfil do dev                                │
│     └─ Vê skills validadas, projetos, código                 │
│     └─ Assiste defesa oral dos bosses                        │
│     └─ Solicita verificação extra (opcional)                 │
│                                                              │
│  4. CONTATO                                                  │
│     └─ Envia convite/mensagem pelo Skilty                    │
│     └─ Ou exporta para ATS próprio                           │
│                                                              │
│  5. FEEDBACK                                                 │
│     └─ Após contratação, dá feedback (30/60/90 dias)         │
│     └─ Melhora o matching futuro                             │
│     └─ Ganha ranking de empregador                           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. Sistema de Validação

### 6.1 Por que validação importa?

A plataforma só vale se as validações forem críveis. Se virar "fábrica de certificado", morre. O sistema de validação é o core do produto.

### 6.2 Camadas de Validação

```
┌─────────────────────────────────────────────────────────────┐
│  CAMADA 1: Automatizada (100% dos projetos)                 │
├─────────────────────────────────────────────────────────────┤
│  └─ CI/CD rodou com sucesso?                                │
│  └─ Testes passaram?                                        │
│  └─ Coverage mínimo atingido?                               │
│  └─ Linting sem erros críticos?                             │
│  └─ Análise estática (complexidade, patterns)               │
│  └─ Deploy funcionando?                                     │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  CAMADA 2: Defesa Oral (recomendado para bosses)            │
├─────────────────────────────────────────────────────────────┤
│  └─ Dev grava vídeo de 3-5 minutos                          │
│  └─ Explica decisões de arquitetura                         │
│  └─ Mostra partes do código                                 │
│  └─ Responde perguntas pré-definidas                        │
│  └─ Muito difícil de falsificar                             │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  CAMADA 3: Peer Review (progressão obriga)                  │
├─────────────────────────────────────────────────────────────┤
│  └─ Devs de nível N revisam devs de nível N-1               │
│  └─ Para subir, você precisa revisar quem está abaixo       │
│  └─ Reviews são meta-avaliadas (qualidade do review conta)  │
│  └─ Cria ciclo virtuoso de ensino                           │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  CAMADA 4: Review de Senior (premium)                       │
├─────────────────────────────────────────────────────────────┤
│  └─ Seniores validados pela plataforma                      │
│  └─ Review detalhado com feedback                           │
│  └─ Selo de qualidade superior                              │
│  └─ Pago pelo dev (premium) ou empresa (patrocínio)         │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 Proteção Contra Fraude

| Vetor de Fraude | Mitigação |
|-----------------|-----------|
| Copiar código de outro dev | Bosses parametrizados (cada dev recebe variação), defesa oral expõe |
| Usar ChatGPT para tudo | Defesa oral exige explicar decisões, histórico de commits analisado |
| Comprar review favorável | Reviews são públicos e meta-avaliados, padrões suspeitos detectados |
| Falsificar perfil | Login via GitHub, código vinculado à conta real |

### 6.4 Transparência

Todo código é público e auditável. Empresas podem:

- Ver o repositório completo
- Analisar histórico de commits
- Verificar se o código realmente funciona (deploy público)
- Assistir a defesa oral
- Solicitar verificação ao vivo (call de 15 min)

---

## 7. Estrutura de Conteúdo

### 7.1 Primeira Árvore: Backend Node.js/TypeScript

Escolhida porque: alta demanda, domínio do autor, profundidade suficiente para múltiplos níveis.

```
                    ┌─────────────────────┐
                    │     ARQUITETO       │
                    │   DE SOLUÇÕES       │
                    │     [RAID]          │
                    └──────────┬──────────┘
                               │
            ┌──────────────────┼──────────────────┐
            │                  │                  │
      ┌─────┴─────┐     ┌──────┴─────┐     ┌─────┴─────┐
      │  System   │     │   Cloud    │     │  Security │
      │  Design   │     │  Native    │     │  Advanced │
      └─────┬─────┘     └──────┬─────┘     └─────┬─────┘
            │                  │                  │
            └──────────────────┼──────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │   BACKEND PLENO     │
                    │      [BOSS 2]       │
                    └──────────┬──────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
   ┌─────┴─────┐        ┌──────┴─────┐        ┌─────┴─────┐
   │   SQL     │        │   API      │        │  Testing  │
   │ Avançado  │        │  Design    │        │  & CI/CD  │
   └─────┬─────┘        └──────┬─────┘        └─────┬─────┘
         │                     │                     │
         └─────────────────────┼─────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │  BACKEND JÚNIOR     │
                    │      [BOSS 1]       │
                    └──────────┬──────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
   ┌─────┴─────┐        ┌──────┴─────┐        ┌─────┴─────┐
   │   Node    │        │    SQL     │        │   HTTP    │
   │  Básico   │        │   Básico   │        │  Básico   │
   └───────────┘        └────────────┘        └───────────┘
```

### 7.2 Exemplo de Skill: "HTTP Básico"

**Conceito:**
Fundamentos do protocolo HTTP: métodos (GET, POST, PUT, DELETE), status codes, headers, body, query params. Como cliente e servidor se comunicam.

**Recursos:**
- MDN Web Docs: HTTP Overview
- Vídeo: "HTTP em 10 minutos"
- Ferramenta: Postman ou Insomnia para testar

**Exercícios:**
- Fazer requisições GET/POST via curl
- Identificar status codes em respostas reais
- Debugar headers de uma requisição

**Critérios de domínio:**
- Sabe a diferença entre GET e POST
- Entende status codes comuns (200, 201, 400, 401, 404, 500)
- Consegue ler e interpretar headers
- Sabe o que é idempotência

### 7.3 Exemplo de Boss: "API REST Completa"

**Contexto:**
Você foi contratado para construir a API de um sistema de gerenciamento de biblioteca. O sistema precisa gerenciar livros, autores e empréstimos.

**Requisitos funcionais:**
- CRUD de livros (título, autor, ISBN, disponibilidade)
- CRUD de autores (nome, bio)
- Registro de empréstimos (quem pegou, quando, devolução)
- Autenticação via JWT
- Busca de livros por título ou autor

**Requisitos técnicos:**
- Node.js + TypeScript
- Framework: Hono, Fastify, ou Express
- Banco: SQLite
- Testes: mínimo 70% coverage
- Documentação: OpenAPI/Swagger
- Deploy: qualquer plataforma (Fly.io, Railway, etc)

**Critérios de avaliação:**
- Todas as rotas funcionando (automático)
- Testes passando (automático)
- Coverage atingido (automático)
- Código limpo e organizado (review)
- Decisões de arquitetura justificadas (defesa oral)

**Skills validadas:**
- HTTP Básico (nível 2)
- Node.js Básico (nível 2)
- SQL Básico (nível 2)
- REST Design (nível 1)
- Auth/JWT (nível 1)
- Testing (nível 1)

---

## 8. Arquitetura Técnica

### 8.1 Filosofia

Stack minimalista. VPS + SQLite. Sem Kubernetes, sem microserviços distribuídos, sem over-engineering. Funciona para os primeiros 10.000 usuários, evolui depois se precisar.

### 8.2 Stack

| Camada | Tecnologia |
|--------|------------|
| Runtime | Bun |
| Framework | Hono |
| Banco | SQLite (WAL mode) |
| ORM | Drizzle |
| Auth | GitHub OAuth |
| Frontend | React/Astro |
| Proxy | Caddy (SSL automático) |
| Infra | VPS (Hetzner/OVH) |
| CI/CD | GitHub Actions |
| Backup | Litestream → S3/B2 |

### 8.3 Estrutura

```
/home/deploy/
├── apps/
│   ├── web/              # frontend público
│   ├── api/              # API principal
│   ├── validator/        # serviço de validação de projetos
│   └── admin/            # painel administrativo
│
├── shared/
│   ├── db/
│   │   └── skilty.db     # banco principal
│   └── lib/              # código compartilhado
│
└── data/
    └── backups/          # backups locais antes de subir
```

### 8.4 Validação de Projetos

```
┌─────────────────────────────────────────────────────────────┐
│  Dev submete link do GitHub                                 │
│                    │                                        │
│                    ▼                                        │
│  ┌─────────────────────────────────────┐                    │
│  │  Validator Service                  │                    │
│  │  └─ Clona repositório               │                    │
│  │  └─ Roda em container isolado       │                    │
│  │  └─ Executa testes do dev           │                    │
│  │  └─ Executa testes do boss          │                    │
│  │  └─ Calcula coverage                │                    │
│  │  └─ Roda linters                    │                    │
│  │  └─ Tenta build/deploy              │                    │
│  │  └─ Gera relatório                  │                    │
│  └─────────────────────────────────────┘                    │
│                    │                                        │
│                    ▼                                        │
│  Relatório salvo + notificação para dev                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. Roadmap

### 9.1 Fase 0: Fundação (Semanas 1-4)

**Objetivo:** Estrutura mínima para começar a produzir conteúdo.

- [ ] Setup do repositório e estrutura de pastas
- [ ] Mapeamento da primeira árvore (Backend Node.js)
- [ ] Escrita de 10-15 skills em Markdown
- [ ] Definição de 2 bosses com critérios claros
- [ ] Site estático simples para visualizar (GitHub Pages ou Astro)

**Entregável:** Conteúdo público acessível, mesmo que sem plataforma.

### 9.2 Fase 1: MVP Técnico (Semanas 5-12)

**Objetivo:** Plataforma mínima funcional para primeiros usuários.

- [ ] Auth via GitHub OAuth
- [ ] Visualização da árvore de skills (React Flow ou similar)
- [ ] Sistema de progresso do usuário
- [ ] Submissão de boss (link GitHub)
- [ ] Validação automatizada básica (CI rodou? Testes passaram?)
- [ ] Perfil público do dev com skills

**Entregável:** Usuários conseguem criar conta, progredir, submeter projetos.

### 9.3 Fase 2: Validação Completa (Semanas 13-20)

**Objetivo:** Sistema de validação robusto e confiável.

- [ ] Container isolado para rodar projetos
- [ ] Testes automatizados dos bosses (além dos do dev)
- [ ] Cálculo de coverage e métricas
- [ ] Upload de defesa oral (vídeo)
- [ ] Sistema de peer review
- [ ] Filas e notificações

**Entregável:** Validação crível, difícil de fraudar.

### 9.4 Fase 3: Lado Empresa (Semanas 21-28)

**Objetivo:** Empresas conseguem buscar e contatar candidatos.

- [ ] Onboarding de empresas
- [ ] Dashboard de busca por skills
- [ ] Visualização de perfis completos
- [ ] Sistema de contato/mensagens
- [ ] Planos pagos e billing

**Entregável:** Primeira receita B2B.

### 9.5 Fase 4: Escala (Semanas 29+)

**Objetivo:** Crescimento sustentável.

- [ ] Mais árvores (Frontend, DevOps, Mobile)
- [ ] Sistema de patrocínio de trilhas
- [ ] Integração com ATSs
- [ ] App mobile
- [ ] Internacionalização (se fizer sentido)

---

## 10. Métricas de Sucesso

### 10.1 Métricas de Produto

| Métrica | Meta Fase 1 | Meta Fase 2 | Meta Fase 3 |
|---------|-------------|-------------|-------------|
| Devs cadastrados | 500 | 2.000 | 10.000 |
| Devs ativos (mês) | 100 | 500 | 2.000 |
| Bosses completados | 50 | 500 | 5.000 |
| Taxa de conclusão de boss | >30% | >40% | >50% |
| Empresas cadastradas | 0 | 10 | 100 |
| Contratações via plataforma | 0 | 5 | 50 |

### 10.2 Métricas de Negócio

| Métrica | Meta Ano 1 | Meta Ano 2 |
|---------|------------|------------|
| MRR | R$5.000 | R$50.000 |
| Devs premium | 50 | 500 |
| Empresas pagantes | 5 | 50 |
| Churn mensal | <10% | <5% |

### 10.3 Métricas de Qualidade

| Métrica | Meta |
|---------|------|
| NPS devs | >50 |
| NPS empresas | >40 |
| Taxa de fraude detectada | <1% |
| Satisfação com contratações | >80% |

---

## 11. Riscos e Mitigações

### 11.1 Riscos de Produto

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| Conteúdo não atrai devs | Média | Alto | Validar early com comunidade, iterar rápido |
| Validação não é crível | Média | Crítico | Múltiplas camadas, defesa oral, transparência |
| Empresas não pagam | Alta | Alto | Começar com empresas conhecidas, provar valor antes |
| Devs fraudam sistema | Média | Alto | Parametrização de bosses, defesa oral, peer review |

### 11.2 Riscos de Execução

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| Escopo muito grande | Alta | Médio | Fases bem definidas, MVP mínimo mesmo |
| Falta de tempo (projeto solo) | Alta | Médio | Priorização rigorosa, dogfooding |
| Complexidade técnica do validator | Média | Médio | Começar simples (só CI), evoluir depois |

### 11.3 Riscos de Mercado

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| Concorrente lança similar | Baixa | Médio | Foco no público BR, integração com Zomme |
| Mercado de contratação esfria | Média | Alto | Diversificar para educação pura se precisar |
| AI substitui devs júnior | Baixa | Alto | Focar em skills que AI não substitui (arquitetura, decisão) |

---

## 12. Diferenciais Competitivos

### 12.1 vs. Bootcamps (Trybe, Rocketseat, DIO)

| Aspecto | Bootcamps | Skilty |
|---------|-----------|--------|
| Modelo | Curso linear, pago | Grafo flexível, gratuito |
| Validação | Certificado genérico | Skills granulares + código real |
| Custo para dev | R$500-2.000/mês ou ISA | Gratuito (premium opcional) |
| Conexão com empresas | Job board genérico | Busca por skills específicas |

### 12.2 vs. Plataformas de Exercícios (LeetCode, HackerRank)

| Aspecto | LeetCode/HR | Skilty |
|---------|-------------|--------|
| Foco | Algoritmos/entrevista | Skills práticas de trabalho |
| Projetos | Exercícios isolados | Projetos completos |
| Contexto | Descontextualizado | Aplicado a domínios reais |
| Progressão | Linear | Árvore flexível |

### 12.3 vs. Faculdade/Pós

| Aspecto | Faculdade | Skilty |
|---------|-----------|--------|
| Tempo | 4-6 anos | No seu ritmo |
| Custo | R$500-3.000/mês | Gratuito |
| Prática | Pouca | 100% prático |
| Atualização | Lenta | Contínua |
| Validação | Diploma genérico | Skills específicas |

---

## 13. Considerações Finais

### 13.1 Por que vai funcionar

O Skilty resolve um problema real dos dois lados do mercado. Devs precisam de direção e validação. Empresas precisam de candidatos confiáveis. O modelo de grafo de skills é comprovado em jogos e funciona para aprendizado não-linear. A integração com o ecossistema Zomme cria um flywheel único.

### 13.2 Por que eu (Djalma) devo fazer isso

- 20+ anos de experiência como desenvolvedor
- Conheço a dor dos dois lados (dev e contratante)
- Já construo os produtos Zomme que servem de case
- Trabalho solo com AI, posso iterar rápido
- Público brasileiro é underserved

### 13.3 O que precisa dar certo

1. Conteúdo precisa ser bom o suficiente para atrair organicamente
2. Validação precisa ser crível para empresas confiarem
3. Primeiras contratações precisam dar certo para criar prova social

### 13.4 Próximo passo imediato

Escrever a primeira skill. Agora.

---

**Documento criado:** Dezembro 2024
**Próxima revisão:** Após completar Fase 0
