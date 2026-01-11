# AuthZ - Corrigir Combining Algorithm

## Problema Atual

A configuracao atual do plugin-authz tem um problema de design:

1. **`defaultEffect: "permit"`** - Quando nenhuma politica corresponde, permite acesso
2. **`combiningAlgorithm: "deny-overrides"`** (default) - Se qualquer politica retorna deny, o deny vence

Isso causa dois problemas:

### Problema 1: Catch-all deny nao funciona com deny-overrides

Com `deny-overrides`, uma politica de deny com `subjects: []` (corresponde a todos) sempre vence, mesmo quando uma politica de permit especifica tambem corresponde.

```javascript
// Exemplo de politicas problematicas
{
  id: "cpanel-admin-access",
  effect: "permit",
  priority: 100,
  subjects: [{ role: "admin" }],  // Corresponde a admin
}
{
  id: "cpanel-deny-others",
  effect: "deny",
  priority: -1,
  subjects: [],  // Corresponde a TODOS (incluindo admin!)
}
// Resultado: Admin eh NEGADO porque deny-overrides
```

### Problema 2: Sem deny policy, defaultEffect permite todos

Se removermos a politica de deny, usuarios sem role admin/viewer nao correspondem a nenhuma politica, e `defaultEffect: "permit"` os permite.

## Solucao Proposta

Alterar a configuracao para usar `first-applicable`:

```jsonc
// manifest.jsonc
"@buntime/plugin-authz",
{
  "combiningAlgorithm": "first-applicable",
  "defaultEffect": "deny",
  "excludePaths": [".*\\.(js|css|woff2?|png|svg|ico|json)$"]
}
```

Com `first-applicable`:
1. Politicas sao avaliadas por prioridade (maior primeiro)
2. A **primeira** politica que corresponder retorna seu efeito
3. Avaliacao para imediatamente

### Fluxo com first-applicable:

| Usuario | Politica Correspondente | Resultado |
|---------|------------------------|-----------|
| Admin   | cpanel-admin-access (priority 100) | permit |
| Viewer  | cpanel-viewer-readonly (priority 90) | permit |
| Outro   | cpanel-deny-others (priority -1) | deny |

## Tarefas

- [ ] Alterar `defaultEffect` para `"deny"` em manifest.jsonc
- [ ] Alterar `combiningAlgorithm` para `"first-applicable"` em manifest.jsonc
- [ ] Restaurar a politica `cpanel-deny-others` em plugin-cpanel (com mensagem clara)
- [ ] Documentar os combining algorithms disponiveis no README do plugin-authz
- [ ] Adicionar testes para validar os diferentes algoritmos

## Alternativa: Melhorar deny-overrides

Outra opcao seria modificar o PDP para que `deny-overrides` considere a prioridade:
- Deny so vence se tiver prioridade >= ao permit correspondente

Isso seria uma mudanca mais complexa no comportamento do algoritmo.

## Referencia

- XACML Combining Algorithms: https://docs.oasis-open.org/xacml/3.0/xacml-3.0-core-spec-os-en.html#_Toc325047268
