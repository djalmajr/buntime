# Bun Plugins

Plugins for Bun build system used by cpanel and other apps.

## Available Plugins

| Plugin | Package | Purpose |
|--------|---------|---------|
| Tailwind | `bun-plugin-tailwind` | Tailwind CSS processing |
| Iconify | `bun-plugin-iconify` | Collects icons from code, generates `virtual:icons` |
| React Compiler | `bun-plugin-react-compiler` | React Compiler for automatic memoization |
| i18next | `bun-plugin-i18next` | i18n translation loading, generates `virtual:i18n` |
| TSR | `bun-plugin-tsr` | TanStack Router route generation |

## bun-plugin-iconify

Scans source files for icon names and generates a virtual module with icon data.

**How it works:**
1. Scans all `.tsx`/`.jsx`/`.ts` files for icon names (`"collection:icon"`)
2. Collects icon data from `@iconify/json`
3. Generates `virtual:icons` module with registry
4. Transforms `<Icon name="..." />` to `<Icon icon={registry["..."]} />`

**Usage:**

```typescript
import { iconifyPlugin } from "bun-plugin-iconify";

Bun.build({
  plugins: [iconifyPlugin({ dirs: "./src" })],
});
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `dirs` | `string \| string[]` | Directories to scan for icon usage |

## bun-plugin-react-compiler

Integrates React Compiler (babel-plugin-react-compiler) for automatic memoization.

**Usage:**

```typescript
import { reactCompilerPlugin } from "bun-plugin-react-compiler";

Bun.build({
  plugins: [reactCompilerPlugin()],
});
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `filter` | `(path: string) => boolean` | Filter which files to compile |
| `compilerOptions` | `object` | React Compiler options |
| `sourceType` | `"module" \| "script" \| "unambiguous"` | Babel source type |

**Compiler Options:**

| Option | Values | Description |
|--------|--------|-------------|
| `compilationMode` | `"all"`, `"annotation"`, `"infer"` | Compilation strategy |
| `target` | `"17"`, `"18"`, `"19"` | React version target |

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
import { i18nextPlugin } from "bun-plugin-i18next";

Bun.build({
  plugins: [i18nextPlugin({ dirs: "./src" })],
});
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `dirs` | `string \| string[]` | Directories to scan for translation files |

**Namespace resolution:**
- `routes/locales/pt.json` → `common`
- `routes/deployments/locales/pt.json` → `deployments`
- `routes/deployments/versions/locales/pt.json` → `deployments.versions`

## bun-plugin-tsr

TanStack Router route generation plugin.

**Usage:**

```typescript
import { tsrPlugin } from "bun-plugin-tsr";

Bun.build({
  plugins: [tsrPlugin({ config: { rootDirectory: "./src" } })],
});
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `watch` | `boolean` | Enable watch mode |
| `config` | `TSRConfig \| TSRConfig[]` | TanStack Router config |

**Config options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `rootDirectory` | `string` | required | Root directory for routes |
| `routesDirectory` | `string` | `"./routes"` | Routes directory relative to root |
| `generatedRouteTree` | `string` | `"routeTree.gen.ts"` | Output file name |
| `quoteStyle` | `"single" \| "double"` | `"double"` | Quote style in generated code |
| `routeFileIgnorePattern` | `string` | `".test."` | Pattern to ignore route files |

## Peer Dependencies

Each plugin declares peer dependencies that must be installed:

| Plugin | Peer Dependencies |
|--------|-------------------|
| `bun-plugin-iconify` | `@iconify/json` |
| `bun-plugin-react-compiler` | `@babel/core`, `@babel/preset-typescript`, `babel-plugin-react-compiler` |
| `bun-plugin-i18next` | - |
| `bun-plugin-tsr` | `@tanstack/router-generator` |
