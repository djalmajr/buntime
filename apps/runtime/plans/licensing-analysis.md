# Buntime - Análise de Licenciamento

## O que é o Buntime

Plataforma serverless completa baseada em Bun com potencial real de monetização.

| Componente | Descrição |
|------------|-----------|
| **Runtime** | Plataforma serverless tipo Cloudflare Workers, self-hosted |
| **12+ Plugins** | Auth, KV store, metrics, rate limiting, database, etc |
| **Dashboard (Papiros)** | Admin UI para gerenciar deployments |
| **Worker Pool** | Orquestração multi-tenant com versionamento |

## Comparativo com Competidores

| Aspecto | Buntime | Cloudflare Workers | Vercel/Netlify | Deno Deploy |
|---------|---------|-------------------|----------------|-------------|
| Self-hosted | ✅ | ❌ | ❌ | ❌ |
| Vendor lock-in | ❌ | ✅ | ✅ | ✅ |
| Plugin ecosystem | ✅ Rico | ❌ Fechado | ❌ Limitado | ❌ Básico |
| Micro-frontends | ✅ Fragment Piercing | ❌ | ❌ | ❌ |
| Dashboard incluído | ✅ | ❌ | ✅ | ✅ |

## Modelos de Monetização Viáveis

### Opção A: Open-Source + SaaS Hosting
- Core runtime: Grátis (Apache 2.0)
- Buntime Cloud: Pay-per-worker ($10-50/mês por app)
- **Comparável:** Vercel, Netlify, Heroku

### Opção B: Open-Source + Premium Plugins
- Core runtime: Grátis
- Premium plugins: $99-999/mês
- **Comparável:** WordPress plugins, npm ecosystem

### Opção C: Enterprise License + Support
- Community edition: Grátis (≤5 apps)
- Enterprise: $50K-500K/ano
- **Comparável:** HashiCorp, JetBrains

### Opção D: Marketplace + Revenue Sharing
- Plugin marketplace com split 70/30
- **Comparável:** AWS Marketplace, Atlassian Marketplace

## Opções de Licença para o Core

### Apache 2.0 (Máxima adoção)
```
Adoção:    ⭐⭐⭐⭐⭐
Proteção:  ⭐⭐
```
- Empresas podem usar livremente
- Monetização via SaaS/plugins/suporte
- **Modelo:** HashiCorp (Terraform), Vercel (Next.js)

### AGPL 3.0 (Proteção forte) ⭐ RECOMENDADO
```
Adoção:    ⭐⭐⭐
Proteção:  ⭐⭐⭐⭐
```
- Quem modificar e hospedar **precisa abrir o código**
- Força empresas a comprarem licença comercial se não quiserem abrir
- **Modelo:** MongoDB (antes do SSPL), Grafana

### BSL - Business Source License (Proteção temporal)
```
Adoção:    ⭐⭐⭐
Proteção:  ⭐⭐⭐⭐
```
- Uso gratuito exceto para produção competitiva
- Após 3-4 anos, vira Apache 2.0
- **Modelo:** MariaDB, CockroachDB, Sentry

## Estrutura Recomendada (Dual License)

```
┌─────────────────────────────────────┐
│  BUNTIME CORE                       │
│  Licença: AGPL 3.0                  │
│  Grátis, open-source                │
└─────────────────────────────────────┘
         │
         ├── Buntime Cloud (SaaS) → Proprietário, pago
         │
         ├── Premium Plugins → Licença comercial
         │
         └── Enterprise License → Suporte + SLA
```

| Componente | Licença | Preço Sugerido |
|------------|---------|----------------|
| Core Runtime | AGPL 3.0 | Grátis |
| Plugins básicos | AGPL 3.0 | Grátis |
| Plugins premium | Comercial | $99-999/mês |
| Buntime Cloud | Proprietário | $0.05-0.10/worker-hora |
| Enterprise | Comercial | $50K+/ano |

## Por que AGPL?

1. **Protege contra AWS/Google** pegarem e venderem como serviço
2. **Força monetização** - empresas que querem usar closed source pagam
3. **Comunidade ainda pode contribuir** - AGPL é open source de verdade
4. **Alternativa comercial** - "não quer AGPL? compre licença comercial"

## Estimativa de Receita

| Cenário | Receita Anual |
|---------|---------------|
| Conservador | $500K (nicho SaaS) |
| Moderado | $5M (plugin marketplace) |
| Otimista | $50M+ (market leader) |

## Timeline Sugerido

- **6 meses**: Launch Buntime Cloud beta
- **12 meses**: Plugin marketplace aberto
- **24 meses**: Programa enterprise maduro

## Decisão Pendente

- [ ] Escolher licença do core (Apache 2.0 vs AGPL 3.0)
- [ ] Definir quais plugins serão gratuitos vs premium
- [ ] Estruturar pricing do Buntime Cloud
- [ ] Criar EULA para licença enterprise
