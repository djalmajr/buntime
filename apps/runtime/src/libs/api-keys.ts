import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { NotFoundError, ValidationError } from "@buntime/shared/errors";

export const KEY_ROLES = ["admin", "editor", "viewer", "custom"] as const;

export type KeyRole = (typeof KEY_ROLES)[number];

export const ALL_PERMISSIONS = [
  "apps:read",
  "apps:install",
  "apps:remove",
  "plugins:read",
  "plugins:install",
  "plugins:remove",
  "plugins:config",
  "keys:read",
  "keys:create",
  "keys:revoke",
  "workers:read",
  "workers:restart",
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export interface ApiKeyInfo {
  createdAt: number;
  createdBy?: number;
  description?: string;
  expiresAt?: number;
  id: number;
  keyPrefix: string;
  lastUsedAt?: number;
  name: string;
  permissions: Permission[];
  role: KeyRole;
}

export interface ApiKeyPrincipal extends ApiKeyInfo {
  isMaster?: boolean;
}

export interface CreateApiKeyInput {
  description?: string;
  expiresIn?: string;
  name?: string;
  permissions?: Permission[];
  role?: KeyRole;
}

export interface CreateApiKeyResult {
  id: number;
  key: string;
  keyPrefix: string;
  name: string;
  role: KeyRole;
}

interface StoredApiKey extends ApiKeyInfo {
  keyHash: string;
  revokedAt?: number;
}

interface KeyStoreFile {
  keys: StoredApiKey[];
  version: 1;
}

const KEY_PREFIX_LENGTH = 12;
const LAST_USED_WRITE_INTERVAL_SECONDS = 60;

const ROLE_PERMISSIONS: Record<Exclude<KeyRole, "custom">, Permission[]> = {
  admin: [...ALL_PERMISSIONS],
  editor: [
    "apps:read",
    "apps:install",
    "apps:remove",
    "plugins:read",
    "plugins:install",
    "plugins:remove",
    "plugins:config",
    "workers:read",
    "workers:restart",
  ],
  viewer: ["apps:read", "plugins:read", "workers:read", "keys:read"],
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function hashesEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, "hex");
  const bBuffer = Buffer.from(b, "hex");
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function generateKey(): string {
  return `btk_${randomBytes(32).toString("base64url")}`;
}

function normalizeRole(role?: string): KeyRole {
  if (!role) return "editor";
  if ((KEY_ROLES as readonly string[]).includes(role)) return role as KeyRole;
  throw new ValidationError(`Invalid role: ${role}`, "INVALID_KEY_ROLE");
}

function normalizePermissions(role: KeyRole, permissions?: string[]): Permission[] {
  if (role !== "custom") return ROLE_PERMISSIONS[role];

  const selected = permissions ?? [];
  if (selected.length === 0) {
    throw new ValidationError("Custom keys require at least one permission", "MISSING_PERMISSIONS");
  }

  for (const permission of selected) {
    if (!(ALL_PERMISSIONS as readonly string[]).includes(permission)) {
      throw new ValidationError(`Invalid permission: ${permission}`, "INVALID_PERMISSION");
    }
  }

  return [...new Set(selected)] as Permission[];
}

function parseExpiresAt(expiresIn?: string): number | undefined {
  if (!expiresIn || expiresIn === "never") return undefined;

  const match = expiresIn.match(/^(\d+)(d|w|m|y)$/);
  if (!match) {
    throw new ValidationError(
      "Invalid expiration. Use never, 30d, 90d, or 1y",
      "INVALID_EXPIRATION",
    );
  }

  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError("Expiration must be greater than zero", "INVALID_EXPIRATION");
  }

  const days =
    unit === "d" ? amount : unit === "w" ? amount * 7 : unit === "m" ? amount * 30 : amount * 365;

  return nowSeconds() + days * 24 * 60 * 60;
}

function toPublicKey(key: StoredApiKey): ApiKeyInfo {
  return {
    createdAt: key.createdAt,
    ...(key.createdBy !== undefined ? { createdBy: key.createdBy } : {}),
    ...(key.description ? { description: key.description } : {}),
    ...(key.expiresAt !== undefined ? { expiresAt: key.expiresAt } : {}),
    id: key.id,
    keyPrefix: key.keyPrefix,
    ...(key.lastUsedAt !== undefined ? { lastUsedAt: key.lastUsedAt } : {}),
    name: key.name,
    permissions: key.permissions,
    role: key.role,
  };
}

function isActive(key: StoredApiKey, at = nowSeconds()): boolean {
  return !key.revokedAt && (!key.expiresAt || key.expiresAt > at);
}

export function hasPermission(principal: ApiKeyPrincipal, permission: Permission): boolean {
  if (principal.isMaster || principal.role === "admin") return true;
  return principal.permissions.includes(permission);
}

export class ApiKeyStore {
  private keys: StoredApiKey[] | null = null;
  private mutex: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  static fromStateDir(stateDir: string): ApiKeyStore {
    return new ApiKeyStore(join(stateDir, "api-keys.json"));
  }

  async list(): Promise<ApiKeyInfo[]> {
    const keys = await this.load();
    return keys.filter((key) => !key.revokedAt).map(toPublicKey);
  }

  async hasKeys(): Promise<boolean> {
    const keys = await this.load();
    return keys.some((key) => !key.revokedAt);
  }

  async verify(rawKey: string | undefined): Promise<ApiKeyPrincipal | null> {
    if (!rawKey) return null;

    const keyHash = hashKey(rawKey);
    const keys = await this.load();
    const at = nowSeconds();
    const match = keys.find((key) => hashesEqual(key.keyHash, keyHash));

    if (!match || !isActive(match, at)) return null;

    if (!match.lastUsedAt || at - match.lastUsedAt >= LAST_USED_WRITE_INTERVAL_SECONDS) {
      await this.touchLastUsed(match.id, at);
    }

    return toPublicKey({ ...match, lastUsedAt: at });
  }

  async create(input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
    return this.locked(async () => {
      const keys = await this.load();
      const name = input.name?.trim();
      if (!name) {
        throw new ValidationError("Key name is required", "MISSING_KEY_NAME");
      }

      const role = normalizeRole(input.role);
      const permissions = normalizePermissions(role, input.permissions);
      const expiresAt = parseExpiresAt(input.expiresIn);
      const key = generateKey();
      const at = nowSeconds();
      const stored: StoredApiKey = {
        createdAt: at,
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        id: keys.reduce((max, current) => Math.max(max, current.id), 0) + 1,
        keyHash: hashKey(key),
        keyPrefix: key.slice(0, KEY_PREFIX_LENGTH),
        name,
        permissions,
        role,
      };

      keys.push(stored);
      await this.save(keys);

      return {
        id: stored.id,
        key,
        keyPrefix: stored.keyPrefix,
        name: stored.name,
        role: stored.role,
      };
    });
  }

  async revoke(id: number): Promise<void> {
    await this.locked(async () => {
      const keys = await this.load();
      const key = keys.find((candidate) => candidate.id === id && !candidate.revokedAt);
      if (!key) {
        throw new NotFoundError(`API key not found: ${id}`, "API_KEY_NOT_FOUND");
      }

      key.revokedAt = nowSeconds();
      await this.save(keys);
    });
  }

  private async touchLastUsed(id: number, timestamp: number): Promise<void> {
    await this.locked(async () => {
      const keys = await this.load();
      const key = keys.find((candidate) => candidate.id === id);
      if (!key || key.revokedAt) return;
      key.lastUsedAt = timestamp;
      await this.save(keys);
    });
  }

  private async load(): Promise<StoredApiKey[]> {
    if (this.keys) return this.keys;

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as KeyStoreFile;
      this.keys = Array.isArray(parsed.keys) ? parsed.keys : [];
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
      if (code !== "ENOENT") throw error;
      this.keys = [];
    }

    return this.keys;
  }

  private async save(keys: StoredApiKey[]): Promise<void> {
    this.keys = keys;
    await mkdir(dirname(this.filePath), { recursive: true });

    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const content = JSON.stringify({ keys, version: 1 } satisfies KeyStoreFile, null, 2);
    await writeFile(tmpPath, `${content}\n`, { mode: 0o600 });
    await rename(tmpPath, this.filePath);
  }

  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutex;
    let release = () => {};
    this.mutex = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
