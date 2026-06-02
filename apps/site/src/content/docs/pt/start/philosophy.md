---
title: Filosofia
description: Os princípios de design por trás do Buntime — por que o runtime é construído do jeito que é.
sidebar:
  order: 2
---

O Buntime faz algumas apostas opinativas. Entendê-las explica quase toda decisão
de API no runtime.

## 1. A thread principal orquestra; nunca executa código de app

O processo que chama `Bun.serve` resolve rotas, roda hooks de plugin e despacha
trabalho — mas o código da aplicação roda **somente** dentro de workers. Um
worker que lança erro, trava ou vaza memória é aposentado e substituído; o
runtime continua servindo. Esta é a invariante mais importante do sistema.

## 2. Workers impõem isolamento real

Cada worker é uma thread separada do Bun com seu próprio heap, seu próprio cache
de módulos e seu próprio `Bun.env` com escopo, injetado no momento do spawn. Dois
apps podem depender de versões diferentes do mesmo pacote sem conflito, e nenhum
app consegue ler os globais de outro. Variáveis de ambiente sensíveis (chaves,
tokens, senhas, URLs de banco) são **filtradas** antes de chegarem a um worker.

## 3. Plugins interceptam sem acoplar uns aos outros

Preocupações transversais — auth, CORS, rate limiting, métricas, proxy — são
plugins. Eles se conectam ao pipeline de requisição/resposta (`onRequest`,
`onResponse`) e podem registrar rotas ou compartilhar serviços, mas nunca
importam uns aos outros diretamente. Dependências são **declaradas** em um
manifest e resolvidas pelo loader, de modo que um plugin pode ser adicionado,
desabilitado ou reordenado sem editar os demais.

## 4. Injeção de base path torna SPAs portáveis

Uma single-page app não deveria precisar saber o prefixo de URL sob o qual está
montada. O runtime injeta `<base href>` (e um header `X-Base`) para que uma SPA
construída para `/` funcione sem mudanças em `/dashboard/`, `/@acme/console/` ou
qualquer outro lugar — sem reconfigurar o bundler.

## 5. Ordenação topológica organiza plugins por dependência

Antes de qualquer `onInit` rodar, os plugins são ordenados com o algoritmo de
Kahn. Um plugin que depende de `@buntime/plugin-turso` é garantidamente
inicializado depois dele, independentemente da ordem no sistema de arquivos.
Ciclos de dependência são um erro fatal detectado na inicialização, não uma
falha misteriosa em tempo de execução.

## 6. Resiliência é o padrão, não um acessório

O loader foi feito para degradar graciosamente:

- Um plugin que falha ao carregar é pulado; seus dependentes também são pulados;
  o resto do sistema carrega normalmente.
- `onInit` tem um **timeout de 30 segundos** — um plugin travado não consegue
  emperrar o boot.
- O shutdown roda os hooks na ordem reversa (LIFO) sob um orçamento global de 30
  segundos, depois força a saída para que uma limpeza presa não bloqueie para
  sempre.

## O que o Buntime *não* é

- **Não é um framework para o seu app.** Seu app é apenas um módulo que exporta um
  handler `fetch` (ou um objeto de rotas, ou um `index.html`). O Buntime o executa;
  não dita como você o escreve.
- **Não é um lugar para regras de negócio.** O runtime é infraestrutura genérica.
  A lógica de domínio pertence aos produtos que rodam sobre ele.
- **Não é um sandbox rígido.** O isolamento de workers é sobre estabilidade e
  higiene (heaps separados, env filtrado), não uma fronteira de segurança
  multi-tenant adversarial por si só. O isolamento de tenants é construído em
  camadas por cima — veja [a plataforma](/pt/platform/multi-tenant/) e
  [segurança](/pt/ops/security/).

:::tip[Ordem de leitura]
Esses princípios mapeiam diretamente nas páginas de aprofundamento: orquestração
e roteamento em [Runtime](/pt/concepts/runtime/), isolamento e TTL em
[Pool de workers](/pt/concepts/worker-pool/), e hooks/dependências em
[Sistema de plugins](/pt/concepts/plugin-system/).
:::
