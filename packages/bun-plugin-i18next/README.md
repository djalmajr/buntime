# @zomme/bun-plugin-i18next

Bun plugin that scans for translation files and generates a virtual module for lazy loading with [i18next](https://www.i18next.com/).

## Features

- Scans directories for `locales/*.json` translation files
- Generates `virtual:i18n` module with dynamic imports for lazy loading
- Automatic namespace detection from file paths
- Zero configuration with sensible defaults
- Supports multiple languages

## Installation

```bash
bun add -d @zomme/bun-plugin-i18next
```

## Usage

### Basic Setup

Add the plugin to your `bunfig.toml`:

```toml
[serve.static]
plugins = ["@zomme/bun-plugin-i18next"]
```

Or use it programmatically:

```typescript
import i18next from "@zomme/bun-plugin-i18next";

Bun.build({
  entrypoints: ["./src/index.tsx"],
  plugins: [i18next],
});
```

### Configuration

Configure via `bunfig.toml`:

```toml
[plugins.i18next]
dirs = ["src"]  # Directories to scan for translation files
```

### Directory Structure

Place translation files in `locales/` directories:

```
src/
├── routes/
│   ├── locales/
│   │   ├── en.json          # namespace: "common"
│   │   └── pt.json
│   ├── dashboard/
│   │   ├── locales/
│   │   │   ├── en.json      # namespace: "dashboard"
│   │   │   └── pt.json
│   │   └── index.tsx
│   └── settings/
│       ├── locales/
│       │   ├── en.json      # namespace: "settings"
│       │   └── pt.json
│       └── index.tsx
└── index.tsx
```

### Namespace Resolution

Namespaces are derived from the directory path:

| File Path | Namespace |
|-----------|-----------|
| `src/routes/locales/en.json` | `common` |
| `src/routes/dashboard/locales/en.json` | `dashboard` |
| `src/routes/settings/profile/locales/en.json` | `settings.profile` |

### Translation File Format

```json
// src/routes/dashboard/locales/en.json
{
  "title": "Dashboard",
  "welcome": "Welcome, {{name}}!",
  "stats": {
    "users": "Total Users",
    "revenue": "Revenue"
  }
}
```

```json
// src/routes/dashboard/locales/pt.json
{
  "title": "Painel",
  "welcome": "Bem-vindo, {{name}}!",
  "stats": {
    "users": "Total de Usuários",
    "revenue": "Receita"
  }
}
```

### Using with i18next

Install the required dependencies:

```bash
bun add i18next i18next-resources-to-backend i18next-browser-languagedetector react-i18next
```

Configure i18next to use the virtual module with `i18next-resources-to-backend`:

```typescript
// src/helpers/i18n.ts
import { translations } from "virtual:i18n";
import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import resourcesToBackend from "i18next-resources-to-backend";
import { initReactI18next } from "react-i18next";

type TranslationLoader = () => Promise<{ default: Record<string, unknown> }>;
type TranslationsMap = Record<string, Record<string, TranslationLoader>>;

i18n
  .use(
    resourcesToBackend((lng: string, ns: string) => {
      const nsTranslations = (translations as TranslationsMap)[ns];
      if (!nsTranslations) {
        return Promise.reject(new Error(`Namespace not found: ${ns}`));
      }
      const loader = nsTranslations[lng];
      if (!loader) {
        return Promise.reject(new Error(`Translation not found: ${ns}/${lng}`));
      }
      return loader();
    }),
  )
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    defaultNS: "common",
    detection: {
      caches: ["localStorage"],
      lookupLocalStorage: "myapp:language",
      order: ["localStorage", "navigator"],
    },
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    nonExplicitSupportedLngs: true,
    react: { useSuspense: false },
    supportedLngs: ["en", "pt"],
  });

export default i18n;
```

### Using in Components

With `i18next-resources-to-backend`, namespaces are loaded automatically:

```tsx
import { useTranslation } from "react-i18next";

export function Dashboard() {
  const { t } = useTranslation("dashboard");

  return (
    <div>
      <h1>{t("title")}</h1>
      <p>{t("welcome", { name: "John" })}</p>
    </div>
  );
}
```

### TypeScript Support

Add type declarations for the virtual module:

```typescript
// src/types/i18n.d.ts
declare module "virtual:i18n" {
  type TranslationLoader = () => Promise<{ default: Record<string, unknown> }>;
  export const translations: Record<string, Record<string, TranslationLoader>>;
}
```

## Generated Module

The plugin generates a `virtual:i18n` module like this:

```typescript
// Auto-generated translations map
const t0 = () => import("/src/routes/locales/en.json");
const t1 = () => import("/src/routes/locales/pt.json");
const t2 = () => import("/src/routes/dashboard/locales/en.json");
const t3 = () => import("/src/routes/dashboard/locales/pt.json");

export const translations = {
  "common": {
    "en": t0,
    "pt": t1
  },
  "dashboard": {
    "en": t2,
    "pt": t3
  }
};
```

## How It Works

1. **Scan**: Plugin scans configured directories for `locales/*.json` files
2. **Detect**: Extracts namespace from directory structure
3. **Generate**: Creates `virtual:i18n` module with dynamic imports
4. **Lazy Load**: Translations are loaded on-demand at runtime

## Benefits

- **Code Splitting**: Each namespace is loaded separately
- **Lazy Loading**: Only load translations when needed
- **Type Safety**: Full TypeScript support
- **Convention-based**: No manual configuration of translation paths

## License

MIT
