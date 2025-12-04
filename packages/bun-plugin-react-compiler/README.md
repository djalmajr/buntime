# @zomme/bun-plugin-react-compiler

Bun plugin that integrates [React Compiler](https://react.dev/learn/react-compiler) (babel-plugin-react-compiler) for automatic memoization of React components.

## Features

- Automatic memoization of React components and hooks
- Eliminates manual `useMemo`, `useCallback`, and `React.memo` usage
- Configurable via `bunfig.toml`
- Smart file skipping (files without JSX or with `"use no memo"` directive)
- Full TypeScript support

## Installation

```bash
bun add -d @zomme/bun-plugin-react-compiler
```

Install peer dependencies:

```bash
bun add -d @babel/core @babel/preset-typescript babel-plugin-react-compiler
```

## Usage

### Basic Setup

Add the plugin to your `bunfig.toml`:

```toml
[serve.static]
plugins = ["@zomme/bun-plugin-react-compiler"]
```

Or use it programmatically:

```typescript
import reactCompiler from "@zomme/bun-plugin-react-compiler";

Bun.build({
  entrypoints: ["./src/index.tsx"],
  plugins: [reactCompiler],
});
```

### Configuration

Configure via `bunfig.toml`:

```toml
[plugins.react-compiler]
target = "19"              # React version: "17", "18", "19"
compilationMode = "all"    # "all", "annotation", "infer"
sourceType = "module"      # "module", "script", "unambiguous"
```

### Configuration Options

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `target` | `"17"`, `"18"`, `"19"` | - | Target React version |
| `compilationMode` | `"all"`, `"annotation"`, `"infer"` | - | Which components to compile |
| `sourceType` | `"module"`, `"script"`, `"unambiguous"` | `"module"` | Babel source type |

### Compilation Modes

- **`all`**: Compiles all components and hooks
- **`annotation`**: Only compiles functions with `"use memo"` directive
- **`infer`**: Lets the compiler decide based on heuristics

## Skipping Files

### Using the `"use no memo"` Directive

Add `"use no memo"` at the top of a file to skip compilation:

```tsx
"use no memo";

// This file will not be processed by React Compiler
export function MyComponent() {
  return <div>Not compiled</div>;
}
```

### Automatic Skipping

The plugin automatically skips files that:

- Don't contain JSX syntax
- Don't import from React

## Example

### Before (Manual Memoization)

```tsx
import { useCallback, useMemo, memo } from "react";

interface Props {
  items: string[];
  onSelect: (item: string) => void;
}

export const ItemList = memo(function ItemList({ items, onSelect }: Props) {
  const sortedItems = useMemo(() => {
    return [...items].sort();
  }, [items]);

  const handleClick = useCallback((item: string) => {
    onSelect(item);
  }, [onSelect]);

  return (
    <ul>
      {sortedItems.map((item) => (
        <li key={item} onClick={() => handleClick(item)}>
          {item}
        </li>
      ))}
    </ul>
  );
});
```

### After (With React Compiler)

```tsx
// No manual memoization needed - React Compiler handles it automatically!

interface Props {
  items: string[];
  onSelect: (item: string) => void;
}

export function ItemList({ items, onSelect }: Props) {
  const sortedItems = [...items].sort();

  const handleClick = (item: string) => {
    onSelect(item);
  };

  return (
    <ul>
      {sortedItems.map((item) => (
        <li key={item} onClick={() => handleClick(item)}>
          {item}
        </li>
      ))}
    </ul>
  );
}
```

## How It Works

1. **Filter**: Plugin processes `.tsx`, `.jsx` files that contain React code
2. **Transform**: Uses Babel with `babel-plugin-react-compiler` to analyze and optimize
3. **Memoize**: Compiler automatically adds memoization where beneficial
4. **Output**: Returns optimized code to Bun's bundler

## Requirements

- Bun >= 1.0.0
- React 17, 18, or 19
- `@babel/core` >= 7.0.0
- `babel-plugin-react-compiler` >= 0.0.0

## Troubleshooting

### Compilation Errors

If you encounter compilation errors, try:

1. Add `"use no memo"` to problematic files
2. Check that your React version matches the `target` config
3. Ensure all peer dependencies are installed

### Performance

For large codebases, compilation can add build time. Consider:

- Using `compilationMode: "annotation"` for selective compilation
- Excluding test files from compilation

## License

MIT
