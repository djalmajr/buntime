# Bun Plugins

Build-time plugins for Bun. Located in `plugins/bun-plugin-*/` folders.

## Available Plugins

| Plugin | Package | Purpose |
|--------|---------|---------|
| [Iconify](../../../plugins/bun-plugin-iconify/README.md) | `@zomme/bun-plugin-iconify` | Icon collection and `virtual:icons` |
| [React Compiler](../../../plugins/bun-plugin-react-compiler/README.md) | `@zomme/bun-plugin-react-compiler` | Automatic memoization |
| [i18next](../../../plugins/bun-plugin-i18next/README.md) | `@zomme/bun-plugin-i18next` | Translation loading and `virtual:i18n` |
| [TSR](../../../plugins/bun-plugin-tsr/README.md) | `@zomme/bun-plugin-tsr` | TanStack Router generation |
| Tailwind | `bun-plugin-tailwind` | Tailwind CSS (external npm) |

## Configuration

Plugins are configured in `bunfig.toml`:

```toml
[serve.static]
plugins = [
  "@zomme/bun-plugin-react-compiler",
  "@zomme/bun-plugin-tsr",
  "@zomme/bun-plugin-iconify",
  "@zomme/bun-plugin-i18next",
  "bun-plugin-tailwind"
]

[plugins.iconify]
dirs = ["src"]

[plugins.i18next]
dirs = ["src"]

[plugins.tsr]
rootDirectory = "src"
```

## Build Script Usage

```typescript
import i18next from "@zomme/bun-plugin-i18next";
import iconify from "@zomme/bun-plugin-iconify";
import reactCompiler from "@zomme/bun-plugin-react-compiler";
import tsr from "@zomme/bun-plugin-tsr";
import tailwind from "bun-plugin-tailwind";

Bun.build({
  entrypoints: ["./src/index.html"],
  plugins: [reactCompiler, i18next, iconify, tailwind, tsr],
  outdir: "./dist",
});
```

## Notes

- Plugins auto-detect `src/` directory if no config provided
- Config in `bunfig.toml` overrides auto-detection
- `bun-plugin-tailwind` is an external npm package (not in workspace)
