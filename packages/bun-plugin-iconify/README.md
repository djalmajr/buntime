# @zomme/bun-plugin-iconify

Bun plugin that collects icons from source code and generates a virtual module with icon data from [Iconify](https://iconify.design/).

## Features

- Scans source files for icon names (e.g., `"lucide:search"`)
- Generates a `virtual:icons` module with only the icons you use
- Supports 150+ icon sets with 200,000+ icons
- Zero runtime overhead - icons are inlined at build time
- Supports both full collection (`@iconify/json`) and individual collections (`@iconify-json/*`)
- HMR support - New icons are automatically detected and hot-reloaded during development

## Installation

```bash
bun add -d @zomme/bun-plugin-iconify
```

Install icon collections (choose one):

```bash
# Option 1: Individual collections (~100KB each) - Recommended
bun add -d @iconify-json/lucide @iconify-json/mdi

# Option 2: All collections (~200MB)
bun add -d @iconify/json
```

## Usage

### Basic Setup

Add the plugin to your `bunfig.toml`:

```toml
[serve.static]
plugins = ["@zomme/bun-plugin-iconify"]
```

Or use it programmatically:

```typescript
import iconify from "@zomme/bun-plugin-iconify";

Bun.build({
  entrypoints: ["./src/index.tsx"],
  plugins: [iconify],
});
```

### Configuration

Configure via `bunfig.toml`:

```toml
[plugins.iconify]
dirs = ["src"]  # Directories to scan for icons
```

### Using Icons

There are two approaches to use icons in your app:

#### Option 1: IconProvider Pattern (Recommended)

This approach uses React Context to provide the icon registry throughout your app. It offers better HMR support and cleaner component code.

**Step 1: Create the Icon component with Context**

Create an Icon component that uses React Context to access the registry. See the full implementation example below in Option 2, but wrap it with a Context provider:

```tsx
// src/components/icon.tsx
import { createContext, type ReactNode, type SVGProps, useContext } from "react";

export interface IconData {
  body: string;
  height: number;
  width: number;
}

export type IconRegistry = Record<string, IconData>;

const IconRegistryContext = createContext<IconRegistry | null>(null);

export interface IconProviderProps {
  children: ReactNode;
  registry: IconRegistry;
}

export function IconProvider({ children, registry }: IconProviderProps) {
  return <IconRegistryContext.Provider value={registry}>{children}</IconRegistryContext.Provider>;
}

export function useIconRegistry(): IconRegistry | null {
  return useContext(IconRegistryContext);
}

export type IconProps = SVGProps<SVGSVGElement> & {
  icon: string | IconData;
};

// Icon component uses useIconRegistry() to get the registry from context
// Then renders an SVG using iconData.body (safe: pre-sanitized from @iconify/json)
export function Icon({ icon, ...props }: IconProps) {
  const registry = useIconRegistry();
  const iconData = typeof icon === "string" ? registry?.[icon] : icon;
  if (!iconData) return null;
  // Render SVG with iconData.body, width, height (see Option 2 for full code)
}
```

**Step 2: Set up the provider in your app entry with HMR support**

```tsx
// src/index.tsx
import { registry } from "virtual:icons";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IconProvider } from "./components/icon";
import { App } from "./app";

// Use import.meta.hot.data to persist the root across HMR updates
const rootElement = document.getElementById("root")!;
const root = (import.meta.hot.data.root ??= createRoot(rootElement));

root.render(
  <StrictMode>
    <IconProvider registry={registry}>
      <App />
    </IconProvider>
  </StrictMode>,
);

// Accept HMR updates to re-render with new registry
import.meta.hot.accept();
```

**Step 3: Use icons anywhere in your app**

```tsx
import { Icon } from "./components/icon";

export function App() {
  return (
    <div>
      <Icon icon="lucide:search" className="size-4" />
      <Icon icon="lucide:user" className="size-4" />
    </div>
  );
}
```

#### Option 2: Direct Registry Import

A simpler approach where the registry is imported directly in the Icon component. Good for smaller apps.

> **Note**: Both options support HMR. The plugin automatically adds the registry import to files containing icon references, ensuring Bun tracks the dependency for hot reloading. Option 1 is recommended for larger apps as it provides a single source of truth and more predictable re-render behavior.

Create an Icon component:

```tsx
// src/components/icon.tsx
import { registry } from "virtual:icons";
import type { SVGProps } from "react";

interface IconData {
  body: string;
  height: number;
  width: number;
}

type IconProps = SVGProps<SVGSVGElement> & {
  /** Icon in format "collection:icon" (e.g. "lucide:search") or IconData object */
  icon: string | IconData;
};

export function Icon({ icon, ...props }: IconProps) {
  const iconData = typeof icon === "string" ? registry[icon] : icon;

  if (!iconData) {
    return null;
  }

  return (
    <svg
      dangerouslySetInnerHTML={{ __html: iconData.body }}
      height="1em"
      viewBox={`0 0 ${iconData.width} ${iconData.height}`}
      width="1em"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    />
  );
}
```

> **Note**: The `iconData.body` contains complete SVG content from `@iconify/json`, including all necessary attributes (fill, stroke, etc.). No additional styling is needed.

Use icons in your components:

```tsx
import { Icon } from "./components/icon";

function App() {
  return (
    <div>
      <Icon icon="lucide:search" className="size-4" />
      <Icon icon="lucide:user" className="size-4" />
      <Icon icon="mdi:home" className="size-6" />
    </div>
  );
}
```

### TypeScript Support

Add type declarations for the virtual module:

```typescript
// src/types/icons.d.ts
declare module "virtual:icons" {
  interface IconData {
    body: string;
    height: number;
    width: number;
  }

  export const registry: Record<string, IconData>;
}
```

## Icon Naming Convention

Icons follow the format `collection:icon-name`:

| Collection | Example | Package |
|------------|---------|---------|
| Lucide | `lucide:search` | `@iconify-json/lucide` |
| Material Design | `mdi:home` | `@iconify-json/mdi` |
| Heroicons | `heroicons:user` | `@iconify-json/heroicons` |
| Tabler | `tabler:settings` | `@iconify-json/tabler` |
| Carbon | `carbon:add` | `@iconify-json/carbon` |

Browse all icons at [Icônes](https://icones.js.org/) or [Iconify](https://icon-sets.iconify.design/).

## How It Works

1. **Scan**: Plugin scans configured directories for icon patterns (`"collection:icon"`)
2. **Collect**: Extracts icon data from installed `@iconify-json/*` or `@iconify/json` packages
3. **Generate**: Creates a registry file at `.cache/iconify/registry.js` with only the icons found in your code
4. **Resolve**: The `virtual:icons` module resolves to this real file
5. **Bundle**: Icons are inlined at build time - no runtime fetching

### HMR (Hot Module Replacement)

During development, the plugin watches source files for changes. When a new icon is added:

1. The watcher detects the file change
2. The new icon is collected and added to the registry
3. The `.cache/iconify/registry.js` file is updated
4. Bun detects the file change and triggers HMR
5. The browser updates with the new icon

> **Note**: When adding a new icon, it may briefly flash (render nothing) while HMR updates the registry. The icon will appear correctly after the second HMR cycle (usually within ~100ms).

### Cache Directory

The plugin creates a `.cache/iconify/` directory in your project root containing the icon registry. Add this to your `.gitignore`:

```gitignore
# Iconify plugin cache
.cache/iconify/
```

## Development Workflow

1. **Start the dev server** - The plugin pre-collects icons from your codebase
2. **Use icons in code** - Write `<Icon icon="lucide:star" />`
3. **Save the file** - The plugin detects the new icon automatically
4. **See the result** - Browser updates via HMR

The plugin logs helpful messages in the terminal:
```
[iconify] Pre-collected 25 icons from 1 dir(s)
[iconify] Updated registry with 25 icons
[iconify] New icons detected in components/my-component.tsx
[iconify] Updated registry with 26 icons
```

## API

### Virtual Module: `virtual:icons`

```typescript
import { registry } from "virtual:icons";

// registry is an object with icon data
registry["lucide:search"]; // { body: "<path.../>", width: 24, height: 24 }
```

### Icon Data Structure

```typescript
interface IconData {
  body: string;   // SVG inner content (includes all attributes like fill, stroke, etc.)
  height: number; // Viewbox height
  width: number;  // Viewbox width
}
```

## License

MIT
