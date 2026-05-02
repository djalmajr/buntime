# buntime CLI/TUI

Cliente Go (CLI + TUI Bubble Tea) para administrar um runtime Buntime via HTTP.

## Documentação

A documentação completa vive na wiki:

- [CLI/TUI — uso, comandos, artefatos de release](../../wiki/apps/cli.md)
- [API Reference do runtime](../../wiki/apps/runtime-api-reference.md)
- [Plugin Deployments — formatos de upload](../../wiki/apps/plugin-deployments.md)

Design da TUI (Bubble Tea + Bubbles + Lip Gloss) em [`docs/tui-design.adoc`](./docs/tui-design.adoc).

## Build local

Requer Go com cgo habilitado (a CLI usa SQLite local em `~/.buntime/config.db`).

```bash
cd apps/cli
go build -o buntime .
```

Para cross-compile, use uma toolchain C compatível com o target. Artefatos de release Linux/macOS/Windows são gerados via GitHub Actions — ver [release-flow](../../wiki/ops/release-flow.md).

## Uso rápido

```bash
buntime --url https://buntime.home --token "$BUNTIME_API_KEY" --insecure
```

`--url` é o base URL público (sem `/api`); `--insecure` apenas para TLS lab/self-signed.
