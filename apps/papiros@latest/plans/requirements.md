# Publicação de Documentação Centralizada

## Contexto

Os projetos em ../*/{README.adoc,docs} utilizam **AsciiDoc** (`.adoc`) como formato de documentação devido às suas vantagens:

- **Multi-formato**: Geração de HTML, PDF, EPUB, MOBI a partir do mesmo fonte
- **Features avançadas**: Numeração automática de títulos (`:sectnums:`), footnotes inline (`footnote:[texto]`), cross-references (`<<seção>>`), includes (`include::file.adoc[]`)
- **Diagramas**: Suporte nativo a Mermaid e outros formatos
- **Variáveis**: Atributos globais (`:version: 1.0` → `{version}`)
- **Condicionais**: `ifdef::backend-pdf[]` para conteúdo específico por formato

### Referência Visual

O objetivo é criar uma experiência similar ao site de updates do VS Code:
https://code.visualstudio.com/updates/v1_107

## Problemática

### 1. Agregação de Release Notes

Múltiplos repositórios no GitLab contêm suas próprias release notes que precisam ser consolidadas em uma página central:

```
https://gitlab.example.com
├── hyper/example-spa/docs
├── hyper/hyper-kanban-front-react/docs
└── ... (N repositórios)
```

**Desafios:**
- Manter consistência visual entre todos os projetos
- Automatizar a coleta de releases de múltiplos repos
- Suportar versionamento por projeto
- Gerar site estático para hospedagem

### 2. Markdown vs AsciiDoc

Markdown (mesmo com extensões como MDX, Pandoc) não oferece equivalência ao AsciiDoc:

| Feature | AsciiDoc | Markdown |
|---------|----------|----------|
| PDF nativo | Sim | Não |
| EPUB nativo | Sim | Não |
| Footnotes inline | `footnote:[texto]` | Separado `[^1]` |
| Include files | `include::file.adoc[]` | Não |
| Cross-references | `<<seção>>` | Limitado |
| Numeração títulos | `:sectnums:` | Não |
| Variáveis | `:attr: valor` | Não |

**Conclusão:** Manter AsciiDoc é a decisão correta para documentação técnica e publicação.

## Resolução

### Solução Escolhida: Antora

[Antora](https://antora.org/) é o gerador de sites de documentação projetado especificamente para AsciiDoc com suporte nativo a múltiplos repositórios.

**Por que Antora:**
- Mesma equipe do Asciidoctor (integração perfeita)
- Multi-repo nativo (agrega docs de N repositórios)
- Versionamento por componente
- Temas customizáveis
- CI/CD friendly (GitLab Pages)

### Arquitetura Proposta

```
┌─────────────────────────────────────────────────────────────┐
│                     GitLab CI/CD                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│   │ Projeto A│  │ Projeto B│  │ Projeto C│                  │
│   │ docs/    │  │ docs/    │  │ docs/    │                  │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘                  │
│        │             │             │                        │
│        └─────────────┼─────────────┘                        │
│                      ▼                                      │
│              ┌──────────────┐                               │
│              │   Antora     │                               │
│              │  Playbook    │                               │
│              └──────┬───────┘                               │
│                     ▼                                       │
│            ┌──────────────────┐                             │
│            │       Pages      │                             │
│            │ docs.empresa.com │                             │
│            └──────────────────┘                             │
└─────────────────────────────────────────────────────────────┘
```

## Referências

- [Antora Documentation](https://docs.antora.org/)
- [Publish to GitLab Pages](https://docs.antora.org/antora/latest/publish-to-gitlab-pages/)
- [AsciiDoc Syntax Reference](https://docs.asciidoctor.org/asciidoc/latest/syntax-quick-reference/)
- [GitLab Release API](https://docs.gitlab.com/api/releases/)
