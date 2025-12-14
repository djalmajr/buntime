/**
 * Get the base path for API calls.
 * Handles both fragment mode (inside shell) and standalone mode.
 */
export function getBasePath(): string {
  // First, try to get base from piercing-fragment-outlet's data attribute
  // This is set when the fragment is loaded inside a shell (e.g., cpanel)
  const outlet = document.querySelector("piercing-fragment-outlet[data-fragment-base]");
  if (outlet) {
    const fragmentBase = outlet.getAttribute("data-fragment-base");
    if (fragmentBase) {
      return fragmentBase.replace(/\/$/, "");
    }
  }

  // Fall back to document's base tag (for standalone mode at /p/deployments)
  const base = document.querySelector("base");
  if (base) {
    const href = base.getAttribute("href") || "";
    return href.replace(/\/$/, "");
  }

  return "";
}

/**
 * Make API requests to the deployments API
 */
export async function apiRequest<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<{ success: boolean; data?: T; error?: string }> {
  const basePath = getBasePath();
  const url = `${basePath}/api${endpoint}`;

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
  const basePath = getBasePath();
  const url = `${basePath}/api/upload`;

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
  const basePath = getBasePath();
  return `${basePath}/api/download?path=${encodeURIComponent(path)}`;
}

/**
 * Get batch download URL
 */
export function getBatchDownloadUrl(paths: string[]): string {
  const basePath = getBasePath();
  const pathsParam = paths.map((p) => encodeURIComponent(p)).join(",");
  return `${basePath}/api/download-batch?paths=${pathsParam}`;
}
