# API Reference

Complete reference for the plugin-deployments API.

## Base URL

All routes are served under the plugin base path:

```
/deployments/api/*
```

## API Mode

The API runs in **serverless mode** — all routes are handled by the worker (`index.ts`), not by persistent hooks in `plugin.ts`. File operations are stateless and benefit from process isolation.

## Path Format

All endpoints that accept a `path` parameter use the format `{rootName}/{relativePath}`:

- **Root listing** (`path=""`) — returns all worker directories as folders
- **App path** (`apps/my-app`) — resolves to `my-app` inside the worker directory named `apps`
- **File path** (`apps/my-app/src/index.ts`) — resolves to a specific file

Hidden directories (names starting with `.`) are excluded from root listing but remain accessible by direct path.

---

## File Operations

### GET /api/list

List directory contents. Returns entries sorted by type (directories first) then alphabetically.

#### Request

```http
GET /deployments/api/list?path=apps/my-app
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | `string` | No | Directory path to list. Empty string returns root listing. |

#### Response (Root Listing)

```json
{
  "success": true,
  "data": {
    "entries": [
      {
        "isDirectory": true,
        "name": "apps",
        "path": "apps",
        "size": 0,
        "modifiedAt": "2025-01-15T10:30:00.000Z"
      },
      {
        "isDirectory": true,
        "name": "staging",
        "path": "staging",
        "size": 0,
        "modifiedAt": "2025-01-14T08:00:00.000Z"
      }
    ],
    "path": ""
  }
}
```

#### Response (Directory Listing)

```json
{
  "success": true,
  "data": {
    "currentVisibility": "public",
    "entries": [
      {
        "isDirectory": true,
        "name": "1.0.0",
        "path": "apps/my-app/1.0.0",
        "size": 245760,
        "files": 42,
        "updatedAt": "2025-01-15T10:30:00.000Z",
        "visibility": "public",
        "configValidation": {
          "valid": true,
          "errors": []
        }
      },
      {
        "isDirectory": false,
        "name": "README.md",
        "path": "apps/my-app/README.md",
        "size": 1024,
        "updatedAt": "2025-01-15T09:00:00.000Z"
      }
    ],
    "path": "apps/my-app"
  }
}
```

**Status:** `200 OK`

**Entry Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `isDirectory` | `boolean` | Whether the entry is a directory |
| `name` | `string` | Entry name |
| `path` | `string` | Full path relative to root (`{rootName}/{relativePath}`) |
| `size` | `number` | File size in bytes, or total size for directories |
| `files` | `number` | Number of files (directories only) |
| `updatedAt` | `string` | ISO 8601 timestamp of last modification |
| `modifiedAt` | `string` | ISO 8601 timestamp (root listing only) |
| `visibility` | `string` | `"public"`, `"protected"`, or `"internal"` (if set) |
| `configValidation` | `object` | Config validation result (version folders only) |

**Notes:**
- Entries with `visibility: "internal"` are filtered out from listing
- `currentVisibility` reflects the visibility of the listed directory itself
- Directory info is cached in `.dirinfo` files for performance

#### Example

```bash
# List root (all worker directories)
curl "http://localhost:8000/deployments/api/list"

# List apps directory
curl "http://localhost:8000/deployments/api/list?path=apps"

# List specific app
curl "http://localhost:8000/deployments/api/list?path=apps/my-app/1.0.0"
```

---

### POST /api/mkdir

Create a new directory.

#### Request

```http
POST /deployments/api/mkdir
Content-Type: application/json

{
  "path": "apps/my-app/1.0.1"
}
```

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | Yes | Path for the new directory |

#### Response

```json
{
  "success": true
}
```

**Status:** `200 OK`

**Error Responses:**

| Status | Error Code | Cause |
|--------|-----------|-------|
| `400` | `PATH_REQUIRED` | Missing `path` in body |
| `400` | `CANNOT_CREATE_AT_ROOT` | Attempted to create directory at root level |
| `404` | `DIR_NOT_FOUND` | Root name does not match any worker directory |

#### Example

```bash
curl -X POST http://localhost:8000/deployments/api/mkdir \
  -H "Content-Type: application/json" \
  -d '{"path": "apps/my-app/1.0.1"}'
```

---

### DELETE /api/delete

Delete a file or directory.

#### Request

```http
DELETE /deployments/api/delete
Content-Type: application/json

{
  "path": "apps/my-app/1.0.0"
}
```

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | Yes | Path of the file or directory to delete |

#### Response

```json
{
  "success": true
}
```

**Status:** `200 OK`

**Error Responses:**

| Status | Error Code | Cause |
|--------|-----------|-------|
| `400` | `PATH_REQUIRED` | Missing `path` in body |
| `400` | `CANNOT_DELETE_ROOT` | Attempted to delete root or a top-level apps directory |
| `404` | `DIR_NOT_FOUND` | Root name does not match any worker directory |

#### Example

```bash
# Delete a version
curl -X DELETE http://localhost:8000/deployments/api/delete \
  -H "Content-Type: application/json" \
  -d '{"path": "apps/my-app/1.0.0"}'

# Delete a file
curl -X DELETE http://localhost:8000/deployments/api/delete \
  -H "Content-Type: application/json" \
  -d '{"path": "apps/my-app/1.0.1/old-file.ts"}'
```

---

### POST /api/rename

Rename a file or directory.

#### Request

```http
POST /deployments/api/rename
Content-Type: application/json

{
  "path": "apps/my-app/1.0.0",
  "newName": "1.0.1"
}
```

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | Yes | Path of the item to rename |
| `newName` | `string` | Yes | New name for the item |

#### Response

```json
{
  "success": true
}
```

**Status:** `200 OK`

**Error Responses:**

| Status | Error Code | Cause |
|--------|-----------|-------|
| `400` | `PATH_AND_NAME_REQUIRED` | Missing `path` or `newName` |
| `400` | `CANNOT_RENAME_ROOT` | Attempted to rename a top-level apps directory |
| `404` | `DIR_NOT_FOUND` | Root name does not match any worker directory |

#### Example

```bash
curl -X POST http://localhost:8000/deployments/api/rename \
  -H "Content-Type: application/json" \
  -d '{"path": "apps/my-app/1.0.0", "newName": "1.0.1"}'
```

---

### POST /api/move

Move a file or directory to a new location.

#### Request

```http
POST /deployments/api/move
Content-Type: application/json

{
  "path": "apps/my-app/1.0.0/src/old-util.ts",
  "destPath": "apps/my-app/1.0.0/lib"
}
```

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | Yes | Path of the item to move |
| `destPath` | `string` | Yes | Destination directory path. Empty string moves to root of same worker dir. |

#### Response

```json
{
  "success": true
}
```

**Status:** `200 OK`

**Error Responses:**

| Status | Error Code | Cause |
|--------|-----------|-------|
| `400` | `PATH_REQUIRED` | Missing `path` |
| `400` | `DEST_PATH_REQUIRED` | Missing `destPath` |
| `400` | `CANNOT_MOVE_ROOT` | Attempted to move a top-level apps directory |
| `400` | `CROSS_DIR_MOVE_NOT_SUPPORTED` | Attempted to move between different worker directories |
| `404` | `DIR_NOT_FOUND` | Root name does not match any worker directory |

**Constraints:**
- Cannot move app or version folders themselves (only files/folders inside versions)
- Destination must be inside a version folder
- Cross-directory moves (between different worker dirs) are not supported
- Destination must already exist and be a directory

#### Example

```bash
curl -X POST http://localhost:8000/deployments/api/move \
  -H "Content-Type: application/json" \
  -d '{"path": "apps/my-app/1.0.0/src/utils.ts", "destPath": "apps/my-app/1.0.0/lib"}'
```

---

### POST /api/upload

Upload files to a deployment. Supports both individual files and zip archives.

#### Request (Individual Files)

```http
POST /deployments/api/upload
Content-Type: multipart/form-data

path=apps/my-app/1.0.0
files=@index.ts
paths=src/index.ts
files=@manifest.yaml
paths=manifest.yaml
```

**Form Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | `string` | Yes | Target directory path |
| `files` | `File[]` | Yes | One or more files to upload |
| `paths` | `string[]` | No | Relative paths for each file (preserves directory structure) |

#### Request (Zip Archive)

```http
POST /deployments/api/upload
Content-Type: multipart/form-data

path=apps/my-app/1.0.0
files=@app.zip
```

When a `.zip` file is uploaded, it is automatically extracted into the target directory.

#### Response

```json
{
  "success": true
}
```

**Status:** `200 OK`

**Error Responses:**

| Status | Error Code | Cause |
|--------|-----------|-------|
| `400` | `NO_FILES_PROVIDED` | No files in the upload |
| `400` | `CANNOT_UPLOAD_TO_ROOT` | Attempted to upload to root level |
| `404` | `DIR_NOT_FOUND` | Root name does not match any worker directory |

#### Examples

```bash
# Upload files with directory structure
curl -X POST http://localhost:8000/deployments/api/upload \
  -F "path=apps/my-app/1.0.0" \
  -F "files=@index.ts" \
  -F "paths=src/index.ts" \
  -F "files=@manifest.yaml" \
  -F "paths=manifest.yaml"

# Upload zip archive (auto-extracted)
curl -X POST http://localhost:8000/deployments/api/upload \
  -F "path=apps/my-app/1.0.0" \
  -F "files=@app.zip"

# Upload single file without path (uses filename)
curl -X POST http://localhost:8000/deployments/api/upload \
  -F "path=apps/my-app/1.0.0" \
  -F "files=@config.json"
```

**Notes:**
- If `paths[]` is not provided for a file, the original filename is used
- Zip files are extracted using `unzip -o -q` (overwrite, quiet mode)
- Subdirectories in `paths[]` are created automatically
- Cache (`.dirinfo`) is invalidated after upload

---

### GET /api/download

Download a file or directory. Directories are returned as zip archives.

#### Request

```http
GET /deployments/api/download?path=apps/my-app/1.0.0
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | `string` | Yes | Path of file or directory to download |

#### Response (File)

Returns the raw file content with appropriate Content-Type header.

```http
HTTP/1.1 200 OK
Content-Disposition: attachment; filename="manifest.yaml"
Content-Type: text/yaml
```

#### Response (Directory)

Returns a zip archive of the directory contents.

```http
HTTP/1.1 200 OK
Content-Disposition: attachment; filename="1.0.0.zip"
Content-Type: application/zip
```

**Status:** `200 OK`

**Error Responses:**

| Status | Error Code | Cause |
|--------|-----------|-------|
| `400` | `PATH_REQUIRED` | Missing `path` parameter |
| `400` | `CANNOT_DOWNLOAD_ROOT` | Attempted to download root |
| `404` | `FILE_NOT_FOUND` | File or directory does not exist |

**Notes:**
- `.dirinfo` cache files are excluded from directory zip downloads
- Zip is streamed directly from the `zip` command (not buffered in memory)

#### Examples

```bash
# Download single file
curl -O http://localhost:8000/deployments/api/download?path=apps/my-app/1.0.0/manifest.yaml

# Download directory as zip
curl -o my-app.zip "http://localhost:8000/deployments/api/download?path=apps/my-app/1.0.0"

# Download entire app (all versions) as zip
curl -o my-app-all.zip "http://localhost:8000/deployments/api/download?path=apps/my-app"
```

---

### GET/POST /api/refresh

Invalidate directory cache (`.dirinfo` files). Useful after external file system changes.

#### Request (GET)

```http
GET /deployments/api/refresh?path=apps/my-app
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | `string` | No | Directory path to refresh. Empty refreshes all worker directories. |

#### Request (POST)

```http
POST /deployments/api/refresh
Content-Type: application/json

{
  "path": "apps/my-app"
}
```

#### Response

```json
{
  "success": true
}
```

**Status:** `200 OK`

#### Examples

```bash
# Refresh all directories
curl http://localhost:8000/deployments/api/refresh

# Refresh specific directory
curl "http://localhost:8000/deployments/api/refresh?path=apps/my-app"

# Refresh via POST
curl -X POST http://localhost:8000/deployments/api/refresh \
  -H "Content-Type: application/json" \
  -d '{"path": "apps/my-app"}'
```

---

## Batch Operations

### POST /api/delete-batch

Delete multiple files or directories in a single request.

#### Request

```http
POST /deployments/api/delete-batch
Content-Type: application/json

{
  "paths": [
    "apps/my-app/1.0.0",
    "apps/my-app/0.9.0",
    "apps/old-app/latest"
  ]
}
```

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `paths` | `string[]` | Yes | Array of paths to delete |

#### Response (All Succeeded)

```json
{
  "success": true
}
```

#### Response (Partial Failure)

```json
{
  "success": true,
  "errors": [
    "apps/my-app: Cannot delete apps directory"
  ]
}
```

**Status:** `200 OK`

**Error Responses:**

| Status | Error Code | Cause |
|--------|-----------|-------|
| `400` | `PATHS_REQUIRED` | Missing or empty `paths` array |

**Notes:**
- The operation continues even if individual deletes fail
- `errors` array is only present when there are failures
- Cannot delete root-level apps directories

#### Example

```bash
curl -X POST http://localhost:8000/deployments/api/delete-batch \
  -H "Content-Type: application/json" \
  -d '{"paths": ["apps/my-app/1.0.0", "apps/my-app/0.9.0"]}'
```

---

### POST /api/move-batch

Move multiple files or directories to a destination.

#### Request

```http
POST /deployments/api/move-batch
Content-Type: application/json

{
  "paths": [
    "apps/my-app/1.0.0/src/old-util.ts",
    "apps/my-app/1.0.0/src/old-helper.ts"
  ],
  "destPath": "apps/my-app/1.0.0/lib"
}
```

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `paths` | `string[]` | Yes | Array of paths to move |
| `destPath` | `string` | Yes | Destination directory path |

#### Response (All Succeeded)

```json
{
  "success": true
}
```

#### Response (Partial Failure)

```json
{
  "success": true,
  "errors": [
    "apps/my-app: Cannot move apps directory",
    "staging/other-app/1.0.0/file.ts: Cannot move between different apps directories"
  ]
}
```

**Status:** `200 OK`

**Error Responses:**

| Status | Error Code | Cause |
|--------|-----------|-------|
| `400` | `PATHS_REQUIRED` | Missing or empty `paths` array |
| `400` | `DEST_PATH_REQUIRED` | Missing `destPath` |

**Constraints:**
- All source paths must be within the same worker directory as the destination
- Cannot move app or version folders themselves

#### Example

```bash
curl -X POST http://localhost:8000/deployments/api/move-batch \
  -H "Content-Type: application/json" \
  -d '{"paths": ["apps/my-app/1.0.0/src/a.ts", "apps/my-app/1.0.0/src/b.ts"], "destPath": "apps/my-app/1.0.0/lib"}'
```

---

### GET /api/download-batch

Download multiple files and directories as a single zip archive.

#### Request

```http
GET /deployments/api/download-batch?paths=apps/my-app,apps/other-app
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `paths` | `string` | Yes | Comma-separated list of paths to include |

#### Response

Returns a zip archive containing all requested items.

```http
HTTP/1.1 200 OK
Content-Disposition: attachment; filename="download-1706000000000.zip"
Content-Type: application/zip
```

**Status:** `200 OK`

**Error Responses:**

| Status | Error Code | Cause |
|--------|-----------|-------|
| `400` | `PATHS_REQUIRED` | Missing or empty `paths` parameter |
| `404` | `NO_VALID_PATHS` | None of the specified paths exist |

**Notes:**
- Items are copied to a temporary directory, zipped, and streamed
- Temporary directory is cleaned up automatically after streaming
- `.dirinfo` cache files are excluded from the zip
- Non-existent paths are silently skipped (warning logged server-side)

#### Examples

```bash
# Download multiple apps
curl -o apps.zip "http://localhost:8000/deployments/api/download-batch?paths=apps/my-app,apps/other-app"

# Download specific versions
curl -o versions.zip "http://localhost:8000/deployments/api/download-batch?paths=apps/my-app/1.0.0,apps/my-app/1.0.1"
```

---

## Errors

### Error Response Format

```json
{
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

### Common Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `PATH_REQUIRED` | `400` | Required path parameter is missing |
| `PATHS_REQUIRED` | `400` | Required paths array is missing or empty |
| `DEST_PATH_REQUIRED` | `400` | Destination path is required |
| `PATH_AND_NAME_REQUIRED` | `400` | Both path and newName are required |
| `NO_FILES_PROVIDED` | `400` | Upload request contains no files |
| `CANNOT_CREATE_AT_ROOT` | `400` | Cannot create directory at root level |
| `CANNOT_DELETE_ROOT` | `400` | Cannot delete root or apps directory |
| `CANNOT_RENAME_ROOT` | `400` | Cannot rename apps directory |
| `CANNOT_MOVE_ROOT` | `400` | Cannot move apps directory |
| `CANNOT_UPLOAD_TO_ROOT` | `400` | Cannot upload to root level |
| `CANNOT_DOWNLOAD_ROOT` | `400` | Cannot download root |
| `CROSS_DIR_MOVE_NOT_SUPPORTED` | `400` | Cannot move between different worker directories |
| `DIR_NOT_FOUND` | `404` | Worker directory not found |
| `FILE_NOT_FOUND` | `404` | File or directory not found |
| `NO_VALID_PATHS` | `404` | No valid paths found for batch download |
| `DOWNLOAD_FAILED` | `400` | Failed to create batch download |

---

## TypeScript Types

### DeploymentsRoutesType

```typescript
// Exported from server/api.ts for Hono RPC type inference
export type DeploymentsRoutesType = typeof api;
```

### FileEntry

```typescript
interface FileEntry {
  isDirectory: boolean;
  name: string;
  path: string;
  size: number;
  updatedAt: string;
  files?: number;
  visibility?: "public" | "protected" | "internal";
  configValidation?: ConfigValidation;
}
```

### DeploymentPathInfo

```typescript
interface DeploymentPathInfo {
  appName: string | null;
  depth: number;
  format: "flat" | "nested" | null;
  isInsideVersion: boolean;
  version: string | null;
}
```

---

## Client SDK Example

### JavaScript/TypeScript

```typescript
class DeploymentsClient {
  constructor(private baseUrl: string) {}

  async list(path = "") {
    const params = new URLSearchParams();
    if (path) params.set("path", path);
    const res = await fetch(`${this.baseUrl}/deployments/api/list?${params}`);
    return res.json();
  }

  async mkdir(path: string) {
    const res = await fetch(`${this.baseUrl}/deployments/api/mkdir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    return res.json();
  }

  async delete(path: string) {
    const res = await fetch(`${this.baseUrl}/deployments/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    return res.json();
  }

  async rename(path: string, newName: string) {
    const res = await fetch(`${this.baseUrl}/deployments/api/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, newName }),
    });
    return res.json();
  }

  async move(path: string, destPath: string) {
    const res = await fetch(`${this.baseUrl}/deployments/api/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, destPath }),
    });
    return res.json();
  }

  async upload(targetPath: string, files: File[], paths?: string[]) {
    const formData = new FormData();
    formData.append("path", targetPath);
    files.forEach((file, i) => {
      formData.append("files", file);
      if (paths?.[i]) formData.append("paths", paths[i]);
    });
    const res = await fetch(`${this.baseUrl}/deployments/api/upload`, {
      method: "POST",
      body: formData,
    });
    return res.json();
  }

  downloadUrl(path: string) {
    return `${this.baseUrl}/deployments/api/download?path=${encodeURIComponent(path)}`;
  }

  async refresh(path?: string) {
    const params = new URLSearchParams();
    if (path) params.set("path", path);
    const res = await fetch(`${this.baseUrl}/deployments/api/refresh?${params}`);
    return res.json();
  }

  async deleteBatch(paths: string[]) {
    const res = await fetch(`${this.baseUrl}/deployments/api/delete-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths }),
    });
    return res.json();
  }

  async moveBatch(paths: string[], destPath: string) {
    const res = await fetch(`${this.baseUrl}/deployments/api/move-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths, destPath }),
    });
    return res.json();
  }

  downloadBatchUrl(paths: string[]) {
    return `${this.baseUrl}/deployments/api/download-batch?paths=${paths.join(",")}`;
  }
}

// Usage
const client = new DeploymentsClient("http://localhost:8000");

// List all worker directories
const root = await client.list();
console.log(root.data.entries);

// List apps in a directory
const apps = await client.list("apps");
console.log(apps.data.entries);

// Create a new version
await client.mkdir("apps/my-app/1.0.0");

// Upload files
const file = new File(["console.log('hello')"], "index.ts");
await client.upload("apps/my-app/1.0.0", [file], ["src/index.ts"]);

// Rename a version
await client.rename("apps/my-app/1.0.0", "1.0.1");

// Delete old versions
await client.deleteBatch(["apps/my-app/0.8.0", "apps/my-app/0.9.0"]);

// Refresh cache after external changes
await client.refresh("apps/my-app");
```

---

## Next Steps

- [Overview](concepts/overview.md) - Architecture and concepts
- [Configuration](guides/configuration.md) - Complete configuration reference
