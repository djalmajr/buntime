---
description: "Enforce direct imports - never create barrel files (index.ts that only re-export)"
alwaysApply: true
---

# No Barrel Files

**NEVER create barrel files (index.ts that only re-export from other files)**

## What are barrel files?

Barrel files are `index.ts` files that only re-export from other modules:

```typescript
// ❌ NEVER create this pattern
// src/utils/index.ts
export { formatDate } from "./format-date.ts";
export { parseUrl } from "./parse-url.ts";
export { slugify } from "./slugify.ts";
```

## Why avoid them?

- **Tree-shaking issues** - Bundlers struggle to eliminate unused code
- **Circular dependencies** - Common source of import cycles
- **Slower IDE** - "Go to definition" goes to barrel instead of source
- **Slower builds** - Extra files to parse and process
- **Hidden complexity** - Harder to understand the dependency graph

## Correct approach

Import directly from the source file:

```typescript
// ✅ CORRECT - Direct imports
import { formatDate } from "@/utils/format-date.ts";
import { parseUrl } from "@/utils/parse-url.ts";
import { slugify } from "@/utils/slugify.ts";
```

## Exception

The `packages/shared/src/types/index.ts` is allowed because it's the package entry point, not a barrel file within a package.

