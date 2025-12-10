# Documentation Style

## Format

Use **AsciiDoc** (`.adoc`) for all documentation. Never use Markdown for docs.

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

Use ASCII art in source blocks:

```asciidoc
[source]
----
┌─────────┐     ┌─────────┐
│ Client  │────▶│ Server  │
└─────────┘     └─────────┘
----
```

## Notes and Tips

```asciidoc
TIP: Helpful suggestion

NOTE: Important information

WARNING: Be careful about this

IMPORTANT: Critical information
```
