---
title: Arquitetura de Micro-Frontend
description: Como o shell do CPanel hospeda UIs de plugins como micro-frontends isolados via <z-frame> e um MessageChannel tipado.
sidebar:
  order: 4
---

O CPanel (shell) hospeda as UIs dos plugins como micro-frontends isolados. Cada
plugin com um entrypoint HTML torna-se um worker independente embutível via
`<z-frame>` (`@zomme/frame`). A comunicação acontece sobre um `MessageChannel`
bidirecional em cima de `postMessage`.

Para saber como os plugins declaram sua UI, veja [Sistema de Plugins](/pt/concepts/plugin-system/).
Para o worker pool que serve cada iframe, veja [Worker Pool](/pt/concepts/worker-pool/).

## Objetivos

| Objetivo | Como |
|------|-----|
| Modularidade | Cada plugin entrega sua própria UI como um worker |
| Independência | Build/deploy isolado por plugin |
| Agnóstico de framework | React, Solid, Qwik, Vue — qualquer um deles |
| Isolamento de segurança | Iframes em sandbox, sem acesso ao DOM do shell |
| Comunicação tipada | MessageChannel + serialização automática (props, eventos, RPC) |

## Topologia

```
Buntime Runtime (port 8000)
├── Shell (CPanel)
│   ├── Layout, navigation
│   └── <z-frame> elements ──┐
└── Workers                  │
    ├── Plugin UI A  ◄───────┤  MessageChannel
    ├── Metrics      ◄───────┤  (props sync, RPC, events)
    ├── Logs         ◄───────┤
    └── ...          ◄───────┘
```

## Pacotes

| Pacote | Papel |
|---------|------|
| `@zomme/frame` | Web component `<z-frame>` (lado do shell) e `frameSDK` (lado do iframe) |
| `@zomme/frame-react` | Bindings React (`useFrameSDK`, `useRouteSync`) |

:::note
O hook `useFrameSDK` também é frequentemente implementado localmente em cada
plugin para evitar uma dependência extra.
:::

## `<z-frame>` — Lado do Shell

Web component que carrega um iframe e gerencia o `MessageChannel`.

```html
<z-frame
  name="metrics"
  base="/metrics"
  src="http://localhost:8000/metrics"
  pathname="/files"
  theme="dark"
></z-frame>
```

### Atributos

| Atributo | Tipo | Descrição |
|-----------|------|-------------|
| `name` | string | Identificador (obrigatório) |
| `src` | string | URL da aplicação no iframe (obrigatório) |
| `base` | string | Caminho base para roteamento (padrão: `/<name>`) |
| `pathname` | string | Caminho inicial (padrão: `/`) |
| `sandbox` | string | Permissões do iframe |

### API JavaScript

```typescript
const frame = document.querySelector("z-frame");

// Dynamic props — automatically synced to the iframe
frame.theme = "dark";
frame.user = currentUser;
frame.apiUrl = "https://api.example.com";

// Emit events to the iframe
frame.emit("route-change", { path: "/settings" });

// RPC: call a function registered by the iframe
const stats = await frame.getStats();

// Listen to events coming from the iframe
frame.addEventListener("ready", () => {});
frame.addEventListener("navigate", (e) => router.push(e.detail.path));
```

## `frameSDK` — Lado do Iframe

```typescript
import { frameSDK } from "@zomme/frame/sdk";

await frameSDK.initialize();  // required before use

// Access props passed by the shell
console.log(frameSDK.props.base);   // "/metrics"
console.log(frameSDK.props.theme);  // "dark"

// Call functions passed by the shell (props that are functions)
await frameSDK.props.onSuccess({ status: "ok" });

// Emit events to the shell
frameSDK.emit("navigate", { path: "/settings" });

// Listen to events from the shell
frameSDK.on("route-change", ({ path }) => router.navigate(path));

// Register functions for the shell to call
frameSDK.register({
  refreshData: async () => loadData(),
  getStats: () => ({ count: 42 }),
});

// Watch for changes on specific props
frameSDK.watch(["theme"], (changes) => {
  if ("theme" in changes) {
    const [next, prev] = changes.theme;
    applyTheme(next);
  }
});
```

## Bindings React

```tsx
import { useFrameSDK, useRouteSync } from "@zomme/frame-react";

function App() {
  const { props, isReady } = useFrameSDK();

  // Sync route with shell
  useRouteSync({
    onRouteChange: (path) => router.navigate(path),
    getCurrentPath: () => router.currentPath,
  });

  if (!isReady) return <Loading />;

  return <h1>Theme: {props.theme}</h1>;
}
```

## Plugin com UI — Estrutura

```
plugins/my-plugin/
├── manifest.yaml              # entrypoint: dist/client/index.html
├── plugin.ts                  # Middleware in the main process
├── server/api.ts              # API (for serverless, goes into index.ts)
├── client/
│   ├── index.tsx              # React entry
│   ├── index.html             # Shell HTML
│   ├── utils/use-frame-sdk.ts # Local hook
│   └── components/
└── dist/
    ├── plugin.js
    └── client/index.html
```

### Manifesto

```yaml
name: "@buntime/my-plugin"
base: "/my-plugin"
entrypoint: dist/client/index.html  # HTML → automatic SPA mode
menus:
  - title: My Plugin
    icon: lucide:cloud-upload
    path: /my-plugin
```

Não existe mais um campo `fragment` no manifesto. Plugins com um `entrypoint`
HTML ficam automaticamente disponíveis como micro-frontends.

### Ponto de entrada do client

```tsx
import { createRoot } from "react-dom/client";
import { frameSDK } from "@zomme/frame/sdk";

await frameSDK.initialize();
frameSDK.register({ refresh: () => window.location.reload() });
createRoot(document.getElementById("root")!).render(<MyPluginPage />);
```

### Integração com o Shell (CPanel)

O CPanel envolve `<z-frame>` em um componente React. Escutar o evento `navigate`
vindo do iframe e propagá-lo via `window.history.pushState` mantém a URL do shell
em sincronia com a navegação interna do plugin. As props
(`base`, `pathname`, `theme`) são passadas como atributos/propriedades em
`<z-frame>` e automaticamente sincronizadas com o iframe via `PROPS_UPDATE`.

## Comunicação — Protocolo

### Fluxo de Inicialização

```
Shell (z-frame)                Iframe                  frameSDK
     │ creates iframe (src)      │                         │
     │──────────────────────────▶ │                         │
     │                            │ load                    │
     │                            │ ──── frameSDK.initialize() ─▶
     │ postMessage(INIT, props,   │                         │
     │              [port2])      │                         │
     │──────────────────────────▶ │                         │
     │                            │ receives port2, props   │
     │                            │ ◀─── port.postMessage(READY) ──
     │ emit('ready')              │                         │
```

### Tipos de Mensagem

| Tipo | Direção | Propósito |
|------|-----------|---------|
| `INIT` | Shell → Frame | Props iniciais + `MessagePort` |
| `READY` | Frame → Shell | Frame inicializado |
| `PROPS_UPDATE` | Shell → Frame | Atualização de props |
| `EVENT` | Shell → Frame | Evento personalizado |
| `CUSTOM_EVENT` | Frame → Shell | Evento personalizado |
| `FUNCTION_CALL` | Bidirecional | Chamada RPC |
| `FUNCTION_RESPONSE` | Bidirecional | Valor de retorno RPC |

### Funções como Props

As funções são serializadas automaticamente — proxy virtual via RPC:

```typescript
// Shell: passes function as prop
frame.onSave = async (data) => {
  await api.save(data);
  return { success: true };
};

// Frame: calls transparently
const result = await frameSDK.props.onSave({ id: 123 });
console.log(result.success);  // true
```

### Funções Registradas

```typescript
// Frame: registers
frameSDK.register("getStats", () => ({ users: 42 }));

// Shell: calls
const stats = await frame.getStats();
```

## Injeção do Caminho Base

O runtime injeta `<base href="/plugin-name/">` no HTML servido ao iframe. Isso
permite que o roteador SPA do plugin funcione como se estivesse na raiz, ao mesmo
tempo em que resolve corretamente caminhos relativos:

```typescript
// client/index.tsx
function getApiBase(): string {
  // Before (piercing/Shadow DOM): complex getRootNode logic
  // Now (frame): simple
  const base = document.querySelector("base");
  return base?.getAttribute("href")?.replace(/\/$/, "") || "/plugin";

  // Or via SDK:
  return frameSDK.props.base;
}
```

A injeção é feita em `wrapper.ts` quando ele detecta uma resposta HTML mais o
cabeçalho `X-Base`. O conteúdo passa por escape de HTML para prevenir XSS. Veja
[o Runtime](/pt/concepts/runtime/) para detalhes sobre o mecanismo.

## Benefícios e Limitações

### Benefícios

| Benefício | Como acontece |
|---------|----------------|
| Isolamento de segurança | Iframe em sandbox — sem acesso ao DOM do shell |
| Deploy independente | Plugin atualizado sem reconstruir o runtime |
| Liberdade tecnológica | Cada plugin escolhe seu framework |
| Comunicação tipada | TypeScript para props/eventos via @zomme/frame |
| Lazy loading | Frames carregam sob demanda |
| Resiliência | Um erro em um frame não afeta o shell |

### Limitações

- Cada frame paga o overhead de um processo + bundle.
- O estado global compartilhado requer o shell como mediador.
- O DevTools é mais complexo — abra o frame em "Open frame in new tab" para
  depuração isolada.

## Migrando de `@buntime/piercing`

O sistema antigo usava Shadow DOM com piercing. Para migrar:

1. Remova a seção `fragment` do `manifest.yaml`.
2. Substitua os imports de `@buntime/piercing` por `@zomme/frame` (ou
   `@zomme/frame-react`).
3. Inicialize o SDK: `await frameSDK.initialize()` no entry do client.
4. Substitua o acesso ao Shadow DOM por `useFrameSDK()` (ou `frameSDK` diretamente).
5. Simplifique `getApiBase()` para usar `<base>` ou `frameSDK.props.base`.

## Documentação Relacionada

- [O Runtime](/pt/concepts/runtime/) — injeção de `<base href>`, cabeçalhos `X-Base`/`X-Not-Found`.
- [Sistema de Plugins](/pt/concepts/plugin-system/) — manifesto com `entrypoint`, `menus`, `injectBase`.
- [Worker Pool](/pt/concepts/worker-pool/) — wrapper que serve o HTML do iframe.
- [Guia de SPA App Shell](/pt/guides/spa-app-shell/) — construindo um SPA de plugin contra o shell.
