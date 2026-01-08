import { S3Client } from "bun";

// Prefix base para todos os paths (ex: "edge-functions/releases@latest/content")
export const S3_PREFIX = process.env.S3_PREFIX || "";

// Credentials for static methods (list, stat, etc.)
const credentials = {
  accessKeyId: process.env.S3_ACCESS_KEY_ID || "minioadmin",
  bucket: process.env.S3_BUCKET || "docs",
  endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "minioadmin",
};

export const s3 = new S3Client(credentials);

/**
 * Construct full path with S3 prefix
 */
export function getFullPath(path: string): string {
  if (!S3_PREFIX) return path;
  return `${S3_PREFIX}/${path}`.replace(/\/+/g, "/");
}

/**
 * Get an S3 file handle for a relative path
 */
export function file(path: string) {
  return s3.file(getFullPath(path));
}

/**
 * Check if a file exists in S3
 */
export async function exists(path: string): Promise<boolean> {
  return s3.file(getFullPath(path)).exists();
}

/**
 * Read file content as text from S3
 */
export async function readText(path: string): Promise<string | null> {
  const s3File = s3.file(getFullPath(path));
  if (!(await s3File.exists())) return null;
  return s3File.text();
}

/**
 * Get file stats (size, lastModified, etc.)
 */
export async function fileStat(path: string) {
  return s3.file(getFullPath(path)).stat();
}

interface S3ListResult {
  commonPrefixes?: string[];
  contents?: Array<{ key: string; lastModified?: Date; size?: number }>;
  isTruncated?: boolean;
}

/**
 * List objects with a prefix (like listing a directory)
 */
export async function listObjects(prefix: string): Promise<string[]> {
  const fullPrefix = getFullPath(prefix);
  const normalizedPrefix = fullPrefix.endsWith("/") ? fullPrefix : `${fullPrefix}/`;

  const result = (await S3Client.list({ prefix: normalizedPrefix }, credentials)) as S3ListResult;

  // Remove the S3_PREFIX from paths returned
  return (
    result.contents?.map((obj) => (S3_PREFIX ? obj.key.replace(`${S3_PREFIX}/`, "") : obj.key)) ??
    []
  );
}

interface ListEntry {
  name: string;
  type: "directory" | "file";
}

/**
 * List immediate children of a "directory" (files and subdirectories)
 * Similar to readdir behavior
 */
export async function listDir(prefix: string): Promise<ListEntry[]> {
  const fullPrefix = getFullPath(prefix);
  const normalizedPrefix = fullPrefix.endsWith("/") ? fullPrefix : `${fullPrefix}/`;

  const result = (await S3Client.list(
    {
      delimiter: "/",
      prefix: normalizedPrefix,
    },
    credentials,
  )) as S3ListResult;

  const entries: ListEntry[] = [];

  // Add directories (common prefixes)
  for (const p of result.commonPrefixes ?? []) {
    // Extract directory name from prefix
    const relativePath = S3_PREFIX ? p.replace(`${S3_PREFIX}/`, "") : p;
    const name = relativePath
      .replace(normalizedPrefix.replace(S3_PREFIX ? `${S3_PREFIX}/` : "", ""), "")
      .replace(/\/$/, "");
    if (name) {
      entries.push({ name, type: "directory" });
    }
  }

  // Add files (contents)
  for (const obj of result.contents ?? []) {
    const relativePath = S3_PREFIX ? obj.key.replace(`${S3_PREFIX}/`, "") : obj.key;
    const name = relativePath.split("/").pop();
    if (name) {
      entries.push({ name, type: "file" });
    }
  }

  return entries;
}

/**
 * Write content to S3
 */
export async function writeFile(path: string, content: string): Promise<void> {
  await s3.write(getFullPath(path), content);
}
