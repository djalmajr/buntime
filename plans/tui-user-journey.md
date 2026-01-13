# TUI User Journey - Do Zero ao Deploy

## Princípios de Design

### Layout

- **Alinhamento à esquerda**: TODO conteúdo deve ser alinhado à esquerda, incluindo:
  - Títulos e labels
  - Inputs e campos de formulário
  - Botões de ação
  - Listas e tabelas
  - Mensagens de erro/sucesso
  - Empty states
- **Sem bordas no wrapper**: O conteúdo principal não deve ter bordas decorativas
- **Consistência**: O mesmo padrão de alinhamento em todas as telas

### Responsividade

- **Viewport com scroll**: Telas devem usar viewport para permitir scroll quando o conteúdo exceder a altura do terminal
- **Dimensões mínimas**: 60 colunas x 15 linhas
- **Degradação graceful**: Em terminais muito pequenos, mostrar mensagem solicitando redimensionamento

### Hierarquia Visual

- Header fixo com: nome do app, versão, breadcrumb, servidor conectado
- Footer fixo com: atalhos de teclado contextuais
- Área de conteúdo com scroll entre header e footer

---

## 0. Armazenamento de API Keys no CLI

### Onde é salvo?

```
~/.buntime/config.db (SQLite)

CREATE TABLE servers (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  url          TEXT NOT NULL UNIQUE,
  api_key      TEXT,              -- NULL se usuário não salvou
  insecure     INTEGER DEFAULT 0,
  last_used_at INTEGER,
  created_at   INTEGER
);
```

### Armazenamento

- **Plain text** no SQLite (`~/.buntime/config.db`)
- Se usuário não salvar: pede a key toda vez que conectar

### Fluxo: Usuário NÃO salvou a key

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Usuário conecta ao servidor sem key salva                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │  Servidor existe no DB?       │
                    └───────────────────────────────┘
                           │              │
                          SIM            NÃO
                           │              │
                           ▼              ▼
               ┌─────────────────┐  ┌─────────────────┐
               │ api_key = NULL? │  │ Add Server Form │
               └─────────────────┘  └─────────────────┘
                    │        │
                   SIM      NÃO
                    │        │
                    ▼        ▼
          ┌──────────────┐  ┌──────────────┐
          │ API Key      │  │ Conectar     │
          │ Prompt       │  │ automatico   │
          └──────────────┘  └──────────────┘
```

### Tela: Reconectar sem Key Salva

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ Servers › Connect                                buntime.mycompany.com       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  AUTHENTICATION REQUIRED                                                     │
│                                                                              │
│  No saved API key for this server.                                           │
│                                                                              │
│  API Key                                                                     │
│  ┌────────────────────────────────────────────────────────────────────┐      │
│  │ ••••••••••••••••••••••••••••••••••••                                │      │
│  └────────────────────────────────────────────────────────────────────┘      │
│  [ctrl+r] toggle visibility                                                  │
│                                                                              │
│  [x] Save API key for this server                                            │
│                                                                              │
│  [ Cancel ]  [ Connect ]                                                     │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [tab] next  [space] toggle  [enter] connect  [esc] cancel                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Fluxograma Geral

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PRIMEIRA EXECUÇÃO                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │   Nenhum servidor cadastrado  │
                    │   "Welcome! Add a server..."  │
                    └───────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │      Add Server Form          │
                    │   - URL                       │
                    │   - Name (auto from host)     │
                    │   - Insecure toggle           │
                    └───────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │      API Key Prompt           │
                    │   "Enter your API key"        │
                    │   - Key input (masked)        │
                    │   - Save key checkbox         │
                    └───────────────────────────────┘
                                    │
                         ┌──────────┴──────────┐
                         ▼                     ▼
                    ┌─────────┐           ┌─────────┐
                    │ Success │           │  Error  │
                    │Connected│           │ Retry?  │
                    └─────────┘           └─────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MAIN MENU                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┬───────────────┐
         ▼               ▼               ▼               ▼
    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
    │ Plugins │    │  Apps   │    │API Keys │    │ Servers │
    └─────────┘    └─────────┘    └─────────┘    └─────────┘
         │               │               │               │
         ▼               ▼               ▼               ▼
    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
    │  List   │    │  List   │    │  List   │    │  List   │
    │ Install │    │ Install │    │ Create  │    │  Add    │
    │ Remove  │    │ Remove  │    │ Revoke  │    │  Edit   │
    │ Enable  │    │         │    │ Clone   │    │ Remove  │
    │ Disable │    │         │    │         │    │         │
    └─────────┘    └─────────┘    └─────────┘    └─────────┘
```

---

## 1. Primeira Execução - Estado Vazio

### 1.1 Welcome Screen (nenhum servidor)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Welcome to Buntime CLI!                                                     │
│                                                                              │
│  No servers configured yet.                                                  │
│  Let's add your first server.                                                │
│                                                                              │
│  [ Add Server ]                                                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [enter] add server  [q] quit                                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Add Server Form

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ Servers › Add                                                                │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Server URL                                                                  │
│  ┌────────────────────────────────────────────────────────────────────┐      │
│  │ https://buntime.mycompany.com                                      │      │
│  └────────────────────────────────────────────────────────────────────┘      │
│                                                                              │
│  Name (optional, auto-generated from URL)                                    │
│  ┌────────────────────────────────────────────────────────────────────┐      │
│  │ buntime.mycompany.com                                              │      │
│  └────────────────────────────────────────────────────────────────────┘      │
│                                                                              │
│  [ ] Skip TLS certificate verification (insecure)                            │
│                                                                              │
│  [ Cancel ]  [ Add Server ]                                                  │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [tab] next field  [enter] submit  [esc] cancel                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 API Key Prompt (após adicionar servidor)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ Servers › Connect                                buntime.mycompany.com       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  AUTHENTICATION REQUIRED                                                     │
│                                                                              │
│  Server requires API key for authentication.                                 │
│                                                                              │
│  API Key                                                                     │
│  ┌────────────────────────────────────────────────────────────────────┐      │
│  │ ••••••••••••••••••••••••••••••••••••                                │      │
│  └────────────────────────────────────────────────────────────────────┘      │
│  [ctrl+r] toggle visibility                                                  │
│                                                                              │
│  [x] Save API key for this server                                            │
│                                                                              │
│  [ Cancel ]  [ Connect ]                                                     │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [tab] next  [space] toggle checkbox  [enter] connect  [esc] cancel          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 1.4 Connection Success

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ Servers › Connect                                buntime.mycompany.com       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ✓ CONNECTED                                                                 │
│                                                                              │
│  Successfully connected to buntime.mycompany.com                             │
│                                                                              │
│  Buntime v1.2.3                                                              │
│  Plugins: 5 enabled                                                          │
│  Apps: 3 installed                                                           │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [enter] continue to main menu                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 1.5 Connection Error

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ Servers › Connect                                buntime.mycompany.com       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ✗ CONNECTION FAILED                                                         │
│                                                                              │
│  Authentication failed - Invalid API key                                     │
│                                                                              │
│  [ Try Again ]  [ Edit Server ]                                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [enter] try again  [e] edit server  [esc] back                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Main Menu (conectado)

### 2.1 Main Menu

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ Main Menu                                        buntime.mycompany.com       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│        ● Plugins                    Manage runtime plugins                   │
│          Apps                       Manage deployed applications             │
│          API Keys                   Manage authentication keys               │
│          ───────────────────────────────────────────────                     │
│          Switch Server              Connect to different server              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [↑↓] navigate  [enter] select  [q] quit                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. API Keys Management

### 3.1 Keys List - Estado Vazio

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ API Keys › List                                  buntime.mycompany.com       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                                                                              │
│                                                                              │
│                         No API keys created yet.                             │
│                                                                              │
│             API keys allow secure access to this server.                     │
│             Create keys for CI/CD pipelines, team members,                   │
│             or other automated systems.                                      │
│                                                                              │
│                            [ Create Key ]                                    │
│                                                                              │
│                                                                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [n] new key  [esc] back                                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Keys List - Com Keys

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ API Keys › List                                  buntime.mycompany.com       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  NAME              ROLE        PREFIX        CREATED       LAST USED         │
│  ─────────────────────────────────────────────────────────────────────────   │
│● Deploy CI/CD      editor      btk_a1b2...   2024-01-01    2 hours ago       │
│  Monitoring        viewer      btk_c3d4...   2024-01-15    5 mins ago        │
│  Admin Backup      admin       btk_e5f6...   2024-02-01    never             │
│  Custom Access     custom      btk_g7h8...   2024-02-10    1 day ago         │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [n] new  [e] edit  [c] clone  [d] revoke  [r] refresh  [esc] back           │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Create Key - Role Selection

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ API Keys › Create                                buntime.mycompany.com       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Name                                                                        │
│  ┌────────────────────────────────────────────┐                              │
│  │ Deploy CI/CD                               │                              │
│  └────────────────────────────────────────────┘                              │
│                                                                              │
│  Role                                                                        │
│  ○ Admin       Full access + manage keys                                     │
│  ● Editor      Manage plugins/apps (install, remove, enable, disable)        │
│  ○ Viewer      Read-only access                                              │
│  ○ Custom      Select specific permissions                                   │
│                                                                              │
│  Expires                                                                     │
│  ○ Never  ○ 30 days  ○ 90 days  ● 1 year  ○ Custom: [____-__-__]             │
│                                                                              │
│                                        [ Cancel ]  [ Create Key ]            │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [tab] next  [space] select  [enter] submit  [esc] cancel                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.4 Create Key - Custom Permissions

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ API Keys › Create                                buntime.mycompany.com       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Name: CI/CD Pipeline                                                        │
│  Role: ● Custom                                                              │
│                                                                              │
│  Permissions                                                                 │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  PLUGINS                          APPS                                 │  │
│  │  [x] plugins:read                 [x] apps:read                        │  │
│  │  [x] plugins:install              [x] apps:install                     │  │
│  │  [x] plugins:remove               [ ] apps:remove                      │  │
│  │  [ ] plugins:enable                                                    │  │
│  │  [ ] plugins:disable              WORKERS                              │  │
│  │  [ ] plugins:config               [ ] workers:read                     │  │
│  │                                   [ ] workers:restart                  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│                                        [ Cancel ]  [ Create Key ]            │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [tab] next  [space] toggle  [a] all  [n] none  [enter] submit               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.5 Key Created - Show Key (única vez)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ API Keys › Created                               buntime.mycompany.com       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                           ✓ API KEY CREATED                                  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                        │  │
│  │   Copy this key now. You won't be able to see it again!               │  │
│  │                                                                        │  │
│  │   btk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6                                 │  │
│  │                                                                        │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  Name: Deploy CI/CD                                                          │
│  Role: editor                                                                │
│  Expires: 2026-01-11                                                         │
│                                                                              │
│                              [ Copy to Clipboard ]  [ Done ]                 │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [c] copy  [enter] done                                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.6 Revoke Key - Confirmation

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ API Keys › Revoke                                buntime.mycompany.com       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                                                                              │
│                          ⚠ REVOKE API KEY                                    │
│                                                                              │
│  You are about to revoke the following key:                                  │
│                                                                              │
│    Name:   Deploy CI/CD                                                      │
│    Role:   editor                                                            │
│    Prefix: btk_a1b2...                                                       │
│                                                                              │
│  This action cannot be undone. Any systems using this key                    │
│  will lose access immediately.                                               │
│                                                                              │
│  Type "revoke" to confirm:                                                   │
│  ┌────────────────────────────────────────────┐                              │
│  │ revoke                                     │                              │
│  └────────────────────────────────────────────┘                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [enter] confirm  [esc] cancel                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Plugins Management

### 4.1 Plugins List - Estado Vazio

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ Plugins › List                                   buntime.mycompany.com       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                                                                              │
│                                                                              │
│                         No plugins installed yet.                            │
│                                                                              │
│             Plugins extend the runtime with additional features              │
│             like authentication, key-value storage, and more.                │
│                                                                              │
│                           [ Install Plugin ]                                 │
│                                                                              │
│                                                                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [i] install  [esc] back                                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Plugins List - Com Plugins

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ Plugins › List                                   buntime.mycompany.com       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  NAME                      VERSION     STATUS      BASE PATH                 │
│  ───────────────────────────────────────────────────────────────────────     │
│● @buntime/plugin-auth      1.2.0       enabled     /auth                     │
│  @buntime/plugin-keyval    2.0.1       enabled     /keyval                   │
│  @buntime/plugin-metrics   1.0.0       disabled    /metrics                  │
│  @buntime/plugin-database  1.1.0       enabled     -                         │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [i] install  [d] remove  [e] enable  [x] disable  [r] refresh  [esc] back   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Install Plugin - Mode Selection

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ Plugins › Install                                buntime.mycompany.com       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                                                                              │
│                        Select installation method                            │
│                                                                              │
│     ┌─────────────────────────────────────────────────────────────────┐      │
│     │                                                                 │      │
│     │   ● Browse for file         Select .zip or .tgz file           │      │
│     │     Browse for directory    Select plugin directory             │      │
│     │     Enter path              Type or paste path directly         │      │
│     │                                                                 │      │
│     └─────────────────────────────────────────────────────────────────┘      │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [↑↓] navigate  [enter] select  [esc] cancel                                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Install Plugin - File Browser

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ Plugins › Install › Browse                       buntime.mycompany.com       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ~/projects/buntime-plugins/                                                 │
│  ───────────────────────────────────────────────────────────────────────     │
│    📁 ..                                                                     │
│    📁 plugin-auth                                                            │
│    📁 plugin-keyval                                                          │
│  ● 📦 plugin-metrics-1.0.0.zip                                               │
│    📦 plugin-cache-2.1.0.tgz                                                 │
│    📄 README.md                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [↑↓] navigate  [enter] select  [/] filter  [~] home  [esc] cancel           │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4.5 Install Plugin - Uploading

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ Plugins › Install                                buntime.mycompany.com       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                         Installing plugin...                                 │
│                                                                              │
│                    plugin-metrics-1.0.0.zip                                  │
│                                                                              │
│                    ████████████████░░░░░░░░░░░░░░░  45%                      │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  Please wait...                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4.6 Install Plugin - Success

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ Plugins › Install                                buntime.mycompany.com       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                                                                              │
│                        ✓ PLUGIN INSTALLED                                    │
│                                                                              │
│  Name:     @buntime/plugin-metrics                                           │
│  Version:  1.0.0                                                             │
│  Path:     /plugins/@buntime/plugin-metrics/1.0.0                            │
│                                                                              │
│  The plugin has been installed but is currently disabled.                    │
│  Would you like to enable it now?                                            │
│                                                                              │
│                            [ Enable Now ]  [ Later ]                         │
│                                                                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [e] enable now  [enter] later  [esc] back to list                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Apps Management

### 5.1 Apps List - Estado Vazio

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ Apps › List                                      buntime.mycompany.com       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                                                                              │
│                                                                              │
│                           No apps deployed yet.                              │
│                                                                              │
│             Apps are worker applications that run on Buntime.                │
│             Deploy your first app to get started.                            │
│                                                                              │
│                             [ Deploy App ]                                   │
│                                                                              │
│                                                                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [i] install  [esc] back                                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Apps List - Com Apps

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ Apps › List                                      buntime.mycompany.com       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  NAME                      VERSION     PATH                                  │
│  ───────────────────────────────────────────────────────────────────────     │
│● @mycompany/dashboard      2.1.0       /apps/@mycompany/dashboard/2.1.0      │
│  @mycompany/api            1.5.2       /apps/@mycompany/api/1.5.2            │
│  todos-app                 1.0.0       /apps/todos-app/1.0.0                 │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [i] install  [d] remove  [r] refresh  [esc] back                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Server Management

### 6.1 Server List (múltiplos servidores)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ Servers › List                                                               │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  NAME                      URL                              LAST USED        │
│  ───────────────────────────────────────────────────────────────────────     │
│● Production                https://buntime.mycompany.com    2 hours ago      │
│  Staging                   https://staging.mycompany.com    1 day ago        │
│  Local Dev                 https://localhost:8000           5 mins ago       │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [enter] connect  [a] add  [e] edit  [d] delete  [esc] back                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Fluxo de Permissões

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      FLUXO DE VERIFICAÇÃO DE PERMISSÃO                       │
└─────────────────────────────────────────────────────────────────────────────┘

Usuário tenta ação (ex: instalar plugin)
              │
              ▼
     ┌─────────────────┐
     │ Verificar role  │
     │ da API key      │
     └─────────────────┘
              │
    ┌─────────┴─────────┬─────────────────┬─────────────────┐
    ▼                   ▼                 ▼                 ▼
┌───────┐          ┌────────┐        ┌────────┐        ┌────────┐
│ admin │          │ editor │        │ viewer │        │ custom │
│  ✓    │          │   ✓    │        │   ✗    │        │   ?    │
└───────┘          └────────┘        └────────┘        └────────┘
                                          │                 │
                                          ▼                 ▼
                                    ┌───────────┐    ┌────────────────┐
                                    │ Exibir    │    │ Verificar      │
                                    │ erro de   │    │ permissions[]  │
                                    │ permissão │    │ tem a ação?    │
                                    └───────────┘    └────────────────┘
                                                            │
                                                     ┌──────┴──────┐
                                                     ▼             ▼
                                                   ┌───┐        ┌───┐
                                                   │ ✓ │        │ ✗ │
                                                   └───┘        └───┘
```

### Mensagem de Erro de Permissão

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BUNTIME CLI                                                     v1.0.0       │
│ Plugins › Install                                buntime.mycompany.com       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                                                                              │
│                        ✗ PERMISSION DENIED                                   │
│                                                                              │
│  Your API key does not have permission to install plugins.                   │
│                                                                              │
│  Current role: viewer                                                        │
│  Required: admin, editor, or custom with plugins:install                     │
│                                                                              │
│  Contact your administrator to request elevated permissions.                 │
│                                                                              │
│                                 [ OK ]                                       │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [enter] ok  [esc] back                                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Resumo do Fluxo Completo

```
1. Primeira execução
   └── Welcome screen (vazio)
       └── Add server
           └── API key prompt
               └── Connected!

2. Main menu
   ├── Plugins
   │   ├── List (vazio/com itens)
   │   ├── Install (browse/path)
   │   ├── Enable/Disable
   │   └── Remove
   │
   ├── Apps
   │   ├── List (vazio/com itens)
   │   ├── Install (browse/path)
   │   └── Remove
   │
   ├── API Keys
   │   ├── List (vazio/com itens)
   │   ├── Create (role + permissions)
   │   ├── Edit (name/description)
   │   ├── Clone
   │   └── Revoke
   │
   └── Switch Server
       ├── List servers
       ├── Add new
       ├── Edit existing
       └── Delete
```
