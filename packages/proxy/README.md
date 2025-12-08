# @buntime/proxy

HTTP and WebSocket proxy extension for Buntime server.

## Features

- Regex path matching with capture groups
- Path rewriting (`$1`, `$2`, etc.)
- Environment variable substitution (`${API_URL}`)
- WebSocket proxy support
- Custom headers

## Configuration

| Option | Type | Description |
|--------|------|-------------|
| `rules` | `ProxyRule[]` | Array of proxy rules |

### ProxyRule

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `pattern` | `string` | required | Regex pattern to match |
| `target` | `string` | required | Target URL (supports `${ENV}`) |
| `rewrite` | `string` | - | Path rewrite with capture groups |
| `changeOrigin` | `boolean` | `false` | Change Host/Origin headers |
| `secure` | `boolean` | `true` | Verify SSL certificates |
| `headers` | `object` | - | Additional headers |
| `ws` | `boolean` | `true` | Enable WebSocket proxy |

## Usage

```typescript
// buntime.config.ts
export default {
  plugins: [
    ["@buntime/proxy", {
      rules: [
        {
          pattern: "^/api/v(\\d+)/(.*)",
          target: "${API_URL}",
          rewrite: "/version/$1/$2",
          changeOrigin: true,
        },
        {
          pattern: "^/ws/(.*)",
          target: "ws://realtime:8080",
          rewrite: "/$1",
        },
      ],
    }],
  ],
}
```

## Priority

**5** - Short-circuits matching requests to proxy target.
