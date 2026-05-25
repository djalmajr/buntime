/**
 * @module
 * Typed client for the runtime's generic file-browser surface. Two mounts
 * are exposed at `/_/api/workers/files/*` and `/_/api/plugins/files/*`; both
 * speak the same shape and this helper is configured per-instance with the
 * appropriate base.
 *
 * All requests go through `runtimeFetch` (cpanel cookie auth + JSON marshal),
 * so the operator session travels automatically.
 */

import { getRuntimeApiUrl, runtimeFetch } from "~/helpers/api-client";

// ---------------------------------------------------------------------------
// Data shapes — mirror `apps/runtime/src/libs/fs/dir-info.ts`
// ---------------------------------------------------------------------------

export interface FileEntry {
  configValidation?: {
    errors?: Array<{ code?: string; message: string; path?: string }>;
    warnings?: Array<{ code?: string; message: string; path?: string }>;
  };
  files?: number;
  isDirectory: boolean;
  modifiedAt?: string;
  name: string;
  path: string;
  size: number;
  updatedAt?: string;
  visibility?: "public" | "protected" | "internal";
}

export interface ListResponse {
  data: {
    currentVisibility?: "public" | "protected" | "internal";
    entries: FileEntry[];
    path: string;
  };
  success: boolean;
}

export interface MutateResponse {
  errors?: string[];
  success: boolean;
}

export interface FsApi {
  readonly base: string;
  list(path?: string): Promise<ListResponse>;
  mkdir(path: string): Promise<MutateResponse>;
  delete(path: string): Promise<MutateResponse>;
  deleteBatch(paths: string[]): Promise<MutateResponse>;
  rename(path: string, newName: string): Promise<MutateResponse>;
  move(path: string, destPath: string): Promise<MutateResponse>;
  moveBatch(paths: string[], destPath: string): Promise<MutateResponse>;
  upload(path: string, files: File[], relativePaths?: string[]): Promise<MutateResponse>;
  refresh(path?: string): Promise<MutateResponse>;
  getDownloadUrl(path: string): Promise<string>;
  getBatchDownloadUrl(paths: string[]): Promise<string>;
}

/**
 * Build a typed FS client bound to a particular mount.
 *
 * @param base e.g. `/workers/files` or `/plugins/files` — the path is joined
 *             with the runtime's discovered API prefix (`/.well-known/buntime`).
 */
export function createFsApi(base: string): FsApi {
  const ep = (suffix: string) => `${base}${suffix}`;

  async function asJson<T>(res: Response): Promise<T> {
    return (await res.json()) as T;
  }

  return {
    base,

    async list(path = "") {
      const res = await runtimeFetch(`${ep("/list")}?path=${encodeURIComponent(path)}`);
      return asJson<ListResponse>(res);
    },

    async mkdir(path) {
      const res = await runtimeFetch(ep("/mkdir"), { json: { path }, method: "POST" });
      return asJson<MutateResponse>(res);
    },

    async delete(path) {
      const res = await runtimeFetch(ep("/delete"), { json: { path }, method: "DELETE" });
      return asJson<MutateResponse>(res);
    },

    async deleteBatch(paths) {
      const res = await runtimeFetch(ep("/delete-batch"), {
        json: { paths },
        method: "POST",
      });
      return asJson<MutateResponse>(res);
    },

    async rename(path, newName) {
      const res = await runtimeFetch(ep("/rename"), {
        json: { newName, path },
        method: "POST",
      });
      return asJson<MutateResponse>(res);
    },

    async move(path, destPath) {
      const res = await runtimeFetch(ep("/move"), {
        json: { destPath, path },
        method: "POST",
      });
      return asJson<MutateResponse>(res);
    },

    async moveBatch(paths, destPath) {
      const res = await runtimeFetch(ep("/move-batch"), {
        json: { destPath, paths },
        method: "POST",
      });
      return asJson<MutateResponse>(res);
    },

    async upload(path, files, relativePaths) {
      const form = new FormData();
      form.append("path", path);
      for (const file of files) {
        form.append("files", file);
      }
      if (relativePaths) {
        for (const p of relativePaths) {
          form.append("paths", p);
        }
      }
      // Skip the JSON content-type — `runtimeFetch` only forces it when `json`
      // is set. Multipart needs the browser-generated boundary.
      const res = await runtimeFetch(ep("/upload"), { body: form, method: "POST" });
      return asJson<MutateResponse>(res);
    },

    async refresh(path = "") {
      const res = await runtimeFetch(ep("/refresh"), { json: { path }, method: "POST" });
      return asJson<MutateResponse>(res);
    },

    async getDownloadUrl(path) {
      return `${await getRuntimeApiUrl(ep("/download"))}?path=${encodeURIComponent(path)}`;
    },

    async getBatchDownloadUrl(paths) {
      const param = paths.map((p) => encodeURIComponent(p)).join(",");
      return `${await getRuntimeApiUrl(ep("/download-batch"))}?paths=${param}`;
    },
  };
}

/** Singleton clients for the two built-in mounts. */
export const workersFsApi = createFsApi("/workers/files");
export const pluginsFsApi = createFsApi("/plugins/files");
