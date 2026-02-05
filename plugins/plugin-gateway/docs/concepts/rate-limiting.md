# Rate Limiting

Request rate control using the Token Bucket algorithm.

## Token Bucket Algorithm

The Token Bucket is a rate limiting algorithm that works like a bucket with fixed capacity:

```
┌─────────────────────────────────┐
│         Token Bucket            │
│                                 │
│  Capacity: 100 tokens           │
│  Refill: 100 tokens / 60s       │
│         = 1.67 tokens/sec       │
│                                 │
│  Current: ████████░░ (80/100)   │
└─────────────────────────────────┘
         │              ▲
         │ Request      │ Refill
         │ (consume 1)  │ (continuous)
         ▼              │
```

### How It Works

1. **Initialization**: Bucket starts full (capacity tokens)
2. **Request**: Each request consumes 1 token
3. **Refill**: Tokens are refilled continuously
4. **Limit**: If no tokens available, request is denied (429)

### Refill Calculation

```typescript
refillRate = capacity / windowSeconds

// Example: 100 requests per minute
capacity = 100
windowSeconds = 60
refillRate = 100 / 60 = 1.67 tokens/sec
```

## Configuration

### Via manifest.yaml

```yaml
rateLimit:
  requests: 100      # Bucket capacity
  window: "1m"       # Time window
  keyBy: ip          # Client identifier
  excludePaths:      # Paths that bypass rate limit
    - "/health"
    - "/_/api/health"
```

### Via Environment Variables

```bash
GATEWAY_RATE_LIMIT_REQUESTS=100
GATEWAY_RATE_LIMIT_WINDOW=1m
```

## Configuration Options

### requests

Maximum bucket capacity (number of tokens).

- **Type:** `number`
- **Default:** `100`
- **Min:** `1`
- **Max:** `10000`

**Example:**
```yaml
rateLimit:
  requests: 1000  # 1000 requests per window
```

### window

Time window for full refill.

- **Type:** `string`
- **Default:** `"1m"`
- **Values:** `"30s"`, `"1m"`, `"5m"`, `"15m"`, `"1h"`

**Example:**
```yaml
rateLimit:
  window: "1h"  # 1 hour
```

### keyBy

Client identification strategy.

- **Type:** `"ip" | "user" | Function`
- **Default:** `"ip"`

**Options:**

#### 1. IP Address

Uses client IP (headers `X-Forwarded-For` or `X-Real-IP`).

```yaml
rateLimit:
  keyBy: ip
```

#### 2. User ID

Uses `X-Identity` header (requires plugin-authn).

```yaml
rateLimit:
  keyBy: user
```

**Expected header:**
```json
X-Identity: {"sub": "user123", ...}
```

**Generated key:** `user:user123`

#### 3. Custom Function

Custom function to extract key.

```typescript
// plugin.ts
rateLimit: {
  keyBy: (req: Request) => {
    const tenantId = req.headers.get("X-Tenant-Id");
    return `tenant:${tenantId}`;
  }
}
```

### excludePaths

Paths that bypass rate limiting (regex patterns).

- **Type:** `string[]`
- **Default:** `[]`

**Example:**
```yaml
rateLimit:
  excludePaths:
    - "/health"
    - "/api/public/.*"
    - "/_/api/.*"
```

## Response Headers

When rate limiting is active, the plugin adds informational headers:

### Success (200-2xx)

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
```

### Rate Limited (429)

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 5
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1706000000000

{
  "error": "Too Many Requests"
}
```

**Headers:**
- `Retry-After`: Seconds until next token
- `X-RateLimit-Limit`: Bucket capacity
- `X-RateLimit-Remaining`: Remaining tokens
- `X-RateLimit-Reset`: Reset timestamp (ms)

## Examples

### Public API (Strict)

```yaml
rateLimit:
  requests: 60
  window: "1m"
  keyBy: ip
  excludePaths:
    - "/health"
```

- 60 requests per minute per IP
- Health endpoint is not limited

### Authenticated API (Per-User)

```yaml
rateLimit:
  requests: 1000
  window: "1h"
  keyBy: user
  excludePaths:
    - "/api/public/.*"
```

- 1000 requests per hour per user
- Public routes are not limited
- Requires plugin-authn

### Multi-Tenant (Custom)

```typescript
// plugin.ts
export default gatewayPlugin({
  rateLimit: {
    requests: 5000,
    window: "1h",
    keyBy: (req) => {
      const tenant = req.headers.get("X-Tenant-Id");
      return tenant ? `tenant:${tenant}` : `ip:${getIp(req)}`;
    },
  },
});
```

## Internal Implementation

### TokenBucket Class

```typescript
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number,
    private refillRate: number
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  consume(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}
```

### RateLimiter Class

Manages multiple buckets (one per client):

```typescript
class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();

  isAllowed(key: string): {
    allowed: boolean;
    remaining: number;
    retryAfter: number;
  } {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(capacity, refillRate);
      this.buckets.set(key, bucket);
    }
    return bucket.consume();
  }
}
```

### Cleanup

Inactive buckets are removed periodically (1 minute):

```typescript
startCleanup(intervalMs: number = 60000) {
  this.cleanupInterval = setInterval(() => {
    // Remove buckets that were not used recently
  }, intervalMs);
}
```

## API Management

The plugin provides endpoints to monitor and manage rate limiting:

### GET /gateway/api/rate-limit/metrics

Get rate limiter metrics and statistics.

**Response:**
```json
{
  "totalRequests": 1500,
  "allowedRequests": 1450,
  "blockedRequests": 50,
  "activeBuckets": 25,
  "blockRate": 0.033
}
```

**Fields:**
- `totalRequests`: Total number of requests processed
- `allowedRequests`: Requests that passed rate limiting
- `blockedRequests`: Requests that were rate limited (429)
- `activeBuckets`: Current number of active client buckets
- `blockRate`: Ratio of blocked requests (0.0 - 1.0)

### GET /gateway/api/rate-limit/buckets

Get active rate limit buckets for all clients.

**Query Parameters:**
- `limit` (optional): Maximum number of buckets to return
- `sortBy` (optional): Sort order - `"tokens"` (lowest first) or `"lastActivity"` (most recent first)

**Example:**
```bash
GET /gateway/api/rate-limit/buckets?limit=10&sortBy=tokens
```

**Response:**
```json
[
  {
    "key": "ip:192.168.1.100",
    "tokens": 25.5,
    "capacity": 100,
    "lastActivity": "2024-01-23T10:30:00.000Z"
  },
  {
    "key": "user:abc123",
    "tokens": 87.2,
    "capacity": 100,
    "lastActivity": "2024-01-23T10:29:55.000Z"
  }
]
```

**Fields:**
- `key`: Client identifier (IP, user, or custom key)
- `tokens`: Current available tokens
- `capacity`: Maximum bucket capacity
- `lastActivity`: Timestamp of last request

### DELETE /gateway/api/rate-limit/buckets/:key

Clear rate limit bucket for a specific client.

**Parameters:**
- `key`: Client identifier (URL-encoded)

**Example:**
```bash
DELETE /gateway/api/rate-limit/buckets/ip%3A192.168.1.100
```

**Response:**
```json
{
  "success": true
}
```

**Use case:** Reset rate limit for a specific client (e.g., after resolving an issue).

### POST /gateway/api/rate-limit/clear

Clear all rate limit buckets.

**Response:**
```json
{
  "success": true,
  "cleared": 25
}
```

**Fields:**
- `success`: Operation status
- `cleared`: Number of buckets removed

**Use case:** Reset all rate limits (e.g., after configuration change or emergency).

## Request Logging Integration

Rate-limited requests are automatically logged for monitoring:

**GET /gateway/api/logs?rateLimited=true**

Filter request logs to show only rate-limited requests (429 responses).

**Response:**
```json
[
  {
    "timestamp": "2024-01-23T10:30:00.000Z",
    "ip": "192.168.1.100",
    "method": "POST",
    "path": "/api/upload",
    "status": 429,
    "duration": 5,
    "rateLimited": true
  }
]
```

**Additional filters:**
- `limit`: Maximum logs to return (default: 100)
- `status`: Filter by HTTP status code
- `ip`: Filter by client IP

**Example:**
```bash
# Get last 50 rate-limited requests
GET /gateway/api/logs?rateLimited=true&limit=50

# Get all 429 responses from specific IP
GET /gateway/api/logs?status=429&ip=192.168.1.100
```

## Statistics

Get gateway statistics including rate limiter status:

```bash
GET /gateway/api/stats
```

**Response:**
```json
{
  "rateLimit": {
    "enabled": true
  },
  "cache": null,
  "cors": {
    "enabled": true
  }
}
```

## Debugging

When `RUNTIME_LOG_LEVEL=debug`:

```
[gateway] Rate limiting: 100 requests per 1m
[gateway] Rate limited: ip:192.168.1.1
```

## Performance

### Memory

Each bucket uses ~100 bytes:
- 10,000 active clients = ~1 MB
- Cleanup removes inactive buckets

### CPU

- O(1) for rate limit check
- Refill is calculated on demand (lazy)
- Cleanup runs every 60 seconds

## Next Steps

- [CORS](cors.md) - CORS configuration
- [Shell Routing](shell-routing.md) - Micro-frontend
- [Configuration](../guides/configuration.md) - Complete reference
