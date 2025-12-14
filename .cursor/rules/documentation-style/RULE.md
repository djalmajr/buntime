---
description: "Documentation style guide - Use AsciiDoc format, professional tone, no emojis in content"
alwaysApply: true
---

# Documentation Style

## Format

Use **AsciiDoc** (`.adoc`) for all documentation. Never use Markdown for docs.

## Tone

- **Professional and mature** - Content for experienced developers
- **Explanatory but not infantilized** - No dramatic introductions or unnecessary analogies
- **Relevant** - Not too verbose, not too minimal
- **No motivational phrases** like "prepare-se para uma mudança de paradigma"

## Automatic Features (Don't Duplicate)

**AsciiDoc handles these automatically via `:sectnums:`:**

- Section numbering - NEVER add manual numbers like `=== 1. Title`
- Table of contents generation

**Never use emojis in content:**

- No emojis in code comments: use `// ERRADO` not `// ❌ ERRADO`
- No emojis in tables: use `Sim`/`Não` not `✅`/`❌`

**Exception:** GitHub captions with emojis ARE allowed (`:tip-caption: 💡`)

## Structure

### Main README.adoc

```asciidoc
= Title
:toc: left
:toclevels: 3
:sectnums:
:sectnumlevels: 5
:icons: font
:source-highlighter: highlightjs

ifdef::env-github[]
:tip-caption: 💡
:note-caption: ℹ️
:important-caption: ⚠️
:caution-caption: 🔥
:warning-caption: ⚠️
endif::[]

toc::[]

== Section

Content...

include::docs/topic.adoc[leveloffset=+1]
```

### Modular Docs

Place detailed topics in `docs/` folder:

```
package/
├── README.adoc           # Main doc with includes
└── docs/
    ├── topic1.adoc       # Detailed topic
    ├── topic2.adoc
    └── roadmap.adoc      # Future plans
```

### Heading Levels

Since docs are included with `[leveloffset=+1]`, they should start at `==`:

- **README.adoc**: `= Title` (level 0), sections use `==`
- **docs/*.adoc**: Start with `==` (becomes `===` when included)

```asciidoc
// docs/logging.adoc
== Logging              // becomes === when included

=== Arquitetura         // becomes ==== when included

==== Funções            // becomes ===== when included
```

## Code Blocks

```asciidoc
[source,typescript]
----
const logger = createLogger({ level: "debug" });
----
```

## Tables

```asciidoc
[cols="1,1,2"]
|===
| Header 1 | Header 2 | Header 3

| Cell 1
| Cell 2
| Cell 3
|===
```

## Diagrams

### ASCII Art

Use ASCII art in source blocks:

```asciidoc
[source]
----
┌─────────┐     ┌─────────┐
│ Client  │────▶│ Server  │
└─────────┘     └─────────┘
----
```

### Mermaid Diagrams

**IMPORTANT: Always use 2 spaces for indentation in Mermaid diagrams.**

```asciidoc
[mermaid]
....
sequenceDiagram
  participant Client
  participant Server

  Client->>Server: Request
  Server-->>Client: Response

  alt Success
    Client->>Server: Process
  else Error
    Client->>Server: Retry
  end
....
```

**Correct indentation:**
- Top-level statements: no indentation
- Nested statements (inside `alt`, `loop`, etc.): 2 spaces
- Deeper nesting: 4 spaces, 6 spaces, etc.

**Example:**

```asciidoc
[mermaid]
....
sequenceDiagram
  participant A
  participant B

  A->>B: Start

  alt Case 1
    B->>A: Response 1
  else Case 2
    B->>A: Response 2
  end

  loop Every minute
    A->>B: Heartbeat
    B-->>A: OK
  end
....
```

## Notes and Tips

```asciidoc
TIP: Helpful suggestion

NOTE: Important information

WARNING: Be careful about this

IMPORTANT: Critical information
```

