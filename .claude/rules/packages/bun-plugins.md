# Bun Plugins

Plugins for Bun build system used by cpanel and other apps. Located in `plugins/` folder.

## Available Plugins

| Plugin | Package | Purpose |
|--------|---------|---------|
| Tailwind | `bun-plugin-tailwind` | Tailwind CSS processing (external npm package) |
| Iconify | `@zomme/bun-plugin-iconify` | Collects icons from code, generates `virtual:icons` |
| React Compiler | `@zomme/bun-plugin-react-compiler` | React Compiler for automatic memoization |
| i18next | `@zomme/bun-plugin-i18next` | i18n translation loading, generates `virtual:i18n` |
| TSR | `@zomme/bun-plugin-tsr` | TanStack Router route generation |

## Configuration via bunfig.toml

Plugins read configuration from `bunfig.toml` using custom `[plugins.*]` sections:

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

If no configuration is provided, plugins fallback to auto-detecting `src/` directory.

## bun-plugin-iconify

Scans source files for icon names and generates a virtual module with icon data.

**How it works:**
1. Scans all `.tsx`/`.jsx`/`.ts` files for icon names (`"collection:icon"`)
2. Collects icon data from `@iconify/json`
3. Generates `virtual:icons` module with registry
4. Transforms `<Icon name="..." />` to `<Icon icon={registry["..."]} />`

**Usage:**

```typescript
import iconify from "@zomme/bun-plugin-iconify";

Bun.build({
  plugins: [iconify],
});
```

**bunfig.toml (optional):**

```toml
[plugins.iconify]
dirs = ["src"]
```

**Behavior:**
- Auto-detects `src/` directory if no config provided
- Config from bunfig.toml `[plugins.iconify]` overrides auto-detection

## bun-plugin-react-compiler

Integrates React Compiler (babel-plugin-react-compiler) for automatic memoization.

**Usage:**

```typescript
import reactCompiler from "@zomme/bun-plugin-react-compiler";

Bun.build({
  plugins: [reactCompiler],
});
```

**bunfig.toml (optional):**

```toml
[plugins.react-compiler]
target = "19"
compilationMode = "all"
sourceType = "module"
```

**Options:**

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `compilationMode` | `"all"`, `"annotation"`, `"infer"` | `"all"` | Compilation strategy |
| `target` | `"17"`, `"18"`, `"19"` | - | React version target |
| `sourceType` | `"module"`, `"script"`, `"unambiguous"` | `"module"` | Babel source type |

**Skipping files:**
- Add `"use no memo"` directive to skip a file
- Files without JSX or React imports are automatically skipped

## bun-plugin-i18next

Scans for translation files and generates a virtual module for lazy loading.

**How it works:**
1. Scans directories for `locales/*.json` files
2. Extracts namespace from path (`routes/deployments/locales/pt.json` → `deployments`)
3. Generates `virtual:i18n` module with dynamic imports

**Usage:**

```typescript
import i18next from "@zomme/bun-plugin-i18next";

Bun.build({
  plugins: [i18next],
});
```

**bunfig.toml (optional):**

```toml
[plugins.i18next]
dirs = ["src"]
```

**Behavior:**
- Auto-detects `src/` directory if no config provided
- Config from bunfig.toml `[plugins.i18next]` overrides auto-detection

**Namespace resolution:**
- `routes/locales/pt.json` → `common`
- `routes/deployments/locales/pt.json` → `deployments`
- `routes/deployments/versions/locales/pt.json` → `deployments.versions`

## bun-plugin-tsr

TanStack Router route generation plugin.

**Usage:**

```typescript
// Using default export (reads from bunfig.toml, auto-detects watch mode)
import tsr from "@zomme/bun-plugin-tsr";

// In bunfig.toml plugins array - works automatically
// In build scripts - call setup manually
await tsr.setup!({} as any);
```

**bunfig.toml:**

```toml
[serve.static]
plugins = [
  "bun-plugin-tsr",
  # ... other plugins
]

# Optional - defaults to src/ if exists
[plugins.tsr]
rootDirectory = "src"
routesDirectory = "./routes"
generatedRouteTree = "routeTree.gen.ts"
```

**Behavior:**
- Auto-detects `src/` directory if no config provided
- Watch mode enabled when `NODE_ENV !== "production"`

**Config options (bunfig.toml `[plugins.tsr]`):**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `rootDirectory` | `string \| string[]` | `"src"` | Root directory for routes |
| `routesDirectory` | `string` | `"./routes"` | Routes directory relative to root |
| `generatedRouteTree` | `string` | `"routeTree.gen.ts"` | Output file name |
| `quoteStyle` | `"single" \| "double"` | `"double"` | Quote style in generated code |
| `routeFileIgnorePattern` | `string` | `".test."` | Pattern to ignore route files |
