export type UploadArchiveKind = "app" | "plugin";

export type UploadArchiveType = "tgz" | "unknown" | "zip";

export type UploadValidationIssueCode =
  | "emptyArchive"
  | "emptyFile"
  | "missingAppEntrypoint"
  | "missingMetadata"
  | "missingPluginEntrypoint"
  | "pathTraversal"
  | "structureDeferred"
  | "tooLarge"
  | "unsupportedType"
  | "wrappedFolder"
  | "zipUnreadable";

export interface UploadValidationIssue {
  code: UploadValidationIssueCode;
  values?: Record<string, number | string>;
}

export interface UploadValidationResult {
  archiveType: UploadArchiveType;
  entries: string[];
  errors: UploadValidationIssue[];
  ok: boolean;
  warnings: UploadValidationIssue[];
}

const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;

const AppEntrypointCandidates = [
  "index.html",
  "index.ts",
  "index.js",
  "index.mjs",
  "dist/index.html",
  "public/index.html",
];

const MetadataCandidates = ["manifest.yaml", "manifest.yml", "package.json"];

const PluginEntrypointCandidates = [
  "plugin.ts",
  "plugin.js",
  "index.ts",
  "index.js",
  "dist/plugin.js",
];

function detectArchiveType(filename: string): UploadArchiveType {
  const normalized = filename.toLowerCase();
  if (normalized.endsWith(".zip")) return "zip";
  if (normalized.endsWith(".tgz") || normalized.endsWith(".tar.gz")) return "tgz";
  return "unknown";
}

function findZipEndOfCentralDirectory(view: DataView): number {
  const minOffset = Math.max(0, view.byteLength - 65_557);

  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) return offset;
  }

  return -1;
}

function getIssue(code: UploadValidationIssueCode, values?: UploadValidationIssue["values"]) {
  return { code, ...(values ? { values } : {}) };
}

function hasPathTraversal(entry: string): boolean {
  const normalized = entry.replaceAll("\\", "/");
  const parts = normalized.split("/");
  return (
    normalized.startsWith("/") ||
    normalized.startsWith("~") ||
    /^[a-zA-Z]:/.test(normalized) ||
    parts.includes("..")
  );
}

async function readZipEntries(file: File): Promise<string[]> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const eocdOffset = findZipEndOfCentralDirectory(view);

  if (eocdOffset < 0) {
    throw new Error("ZIP end of central directory not found");
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder();
  const entries: string[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("Invalid ZIP central directory");
    }

    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    const name = decoder.decode(new Uint8Array(buffer, nameStart, fileNameLength));

    if (name && !name.endsWith("/")) {
      entries.push(name.replaceAll("\\", "/"));
    }

    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function normalizeRuntimeEntries(entries: string[]): { entries: string[]; wrappedFolder?: string } {
  if (entries.length === 0) return { entries };

  const rootEntries = entries.filter((entry) => !entry.includes("/"));
  if (rootEntries.length > 0) return { entries };

  const topLevel = new Set(entries.map((entry) => entry.split("/")[0]).filter(Boolean));
  if (topLevel.size !== 1) return { entries };

  const [folder] = [...topLevel];
  if (folder === "package") {
    return { entries: entries.map((entry) => entry.replace(/^package\//, "")) };
  }

  return { entries, wrappedFolder: folder };
}

function hasAnyEntry(entries: string[], candidates: string[]): boolean {
  const entrySet = new Set(entries);
  return candidates.some((candidate) => entrySet.has(candidate));
}

function validateZipStructure(
  entries: string[],
  kind: UploadArchiveKind,
): { errors: UploadValidationIssue[]; normalizedEntries: string[] } {
  const errors: UploadValidationIssue[] = [];

  if (entries.length === 0) {
    errors.push(getIssue("emptyArchive"));
    return { errors, normalizedEntries: entries };
  }

  for (const entry of entries) {
    if (hasPathTraversal(entry)) {
      errors.push(getIssue("pathTraversal", { entry }));
      break;
    }
  }

  const normalized = normalizeRuntimeEntries(entries);
  if (normalized.wrappedFolder) {
    errors.push(getIssue("wrappedFolder", { folder: normalized.wrappedFolder }));
  }

  if (!hasAnyEntry(normalized.entries, MetadataCandidates)) {
    errors.push(getIssue("missingMetadata"));
  }

  if (kind === "app" && !hasAnyEntry(normalized.entries, AppEntrypointCandidates)) {
    errors.push(getIssue("missingAppEntrypoint"));
  }

  if (kind === "plugin" && !hasAnyEntry(normalized.entries, PluginEntrypointCandidates)) {
    errors.push(getIssue("missingPluginEntrypoint"));
  }

  return { errors, normalizedEntries: normalized.entries };
}

export async function validateUploadFile(
  file: File,
  kind: UploadArchiveKind,
): Promise<UploadValidationResult> {
  const archiveType = detectArchiveType(file.name);
  const errors: UploadValidationIssue[] = [];
  const warnings: UploadValidationIssue[] = [];
  let entries: string[] = [];

  if (file.size === 0) {
    errors.push(getIssue("emptyFile"));
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    errors.push(
      getIssue("tooLarge", {
        maxMb: MAX_UPLOAD_SIZE_BYTES / 1024 / 1024,
      }),
    );
  }

  if (archiveType === "unknown") {
    errors.push(getIssue("unsupportedType"));
  }

  if (errors.length === 0 && archiveType === "zip") {
    try {
      entries = await readZipEntries(file);
      const result = validateZipStructure(entries, kind);
      entries = result.normalizedEntries;
      errors.push(...result.errors);
    } catch {
      errors.push(getIssue("zipUnreadable"));
    }
  }

  if (errors.length === 0 && archiveType === "tgz") {
    warnings.push(getIssue("structureDeferred"));
  }

  return {
    archiveType,
    entries,
    errors,
    ok: errors.length === 0,
    warnings,
  };
}
