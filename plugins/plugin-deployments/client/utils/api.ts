import manifest from "../../manifest.yaml";

const BASE = manifest.base;

/**
 * Make API requests to the deployments API
 */
export async function apiRequest<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<{ success: boolean; data?: T; error?: string }> {
  const url = `${BASE}/api${endpoint}`;

  try {
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      ...options,
    });

    const json = await res.json();
    return json;
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Request failed",
      success: false,
    };
  }
}

/**
 * Upload files to the deployments API
 */
export async function uploadFiles(
  path: string,
  files: File[],
  paths: string[],
): Promise<{ success: boolean; error?: string }> {
  const url = `${BASE}/api/upload`;

  const formData = new FormData();
  formData.append("path", path);
  for (const file of files) {
    formData.append("files", file);
  }
  for (const p of paths) {
    formData.append("paths", p);
  }

  try {
    const res = await fetch(url, {
      body: formData,
      method: "POST",
    });

    const json = await res.json();
    return json;
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Upload failed",
      success: false,
    };
  }
}

/**
 * Get download URL for a file
 */
export function getDownloadUrl(path: string): string {
  return `${BASE}/api/download?path=${encodeURIComponent(path)}`;
}

/**
 * Get batch download URL
 */
export function getBatchDownloadUrl(paths: string[]): string {
  const pathsParam = paths.map((p) => encodeURIComponent(p)).join(",");
  return `${BASE}/api/download-batch?paths=${pathsParam}`;
}
