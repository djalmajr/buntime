/**
 * Get the base path for API calls.
 * When loaded via fragment-outlet, extracts plugin path from src attribute.
 * Falls back to base tag for standalone mode.
 */
export function getApiBase(): string {
  const rootElement = document.getElementById("plugin-deployments-root");
  if (!rootElement) return "/deployments";

  // Fragment content is inside Shadow DOM, host is the fragment-outlet
  const rootNode = rootElement.getRootNode();
  if (rootNode instanceof ShadowRoot) {
    // Get the src attribute from fragment-outlet (this is where APIs are served)
    const outlet = rootNode.host;
    const src = outlet?.getAttribute("src");
    if (src) {
      // Extract the plugin path from src (e.g., "/deployments" from "/deployments/files")
      const match = src.match(/^(\/[^/]+)/);
      return match?.[1] || "/deployments";
    }
  }

  // Fallback: read from base tag (standalone mode)
  const base = document.querySelector("base");
  if (base) {
    const href = base.getAttribute("href") || "";
    return href.replace(/\/$/, "") || "/deployments";
  }
  return "/deployments";
}

/**
 * Make API requests to the deployments API
 */
export async function apiRequest<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<{ success: boolean; data?: T; error?: string }> {
  const basePath = getApiBase();
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
  const basePath = getApiBase();
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
  const basePath = getApiBase();
  return `${basePath}/api/download?path=${encodeURIComponent(path)}`;
}

/**
 * Get batch download URL
 */
export function getBatchDownloadUrl(paths: string[]): string {
  const basePath = getApiBase();
  const pathsParam = paths.map((p) => encodeURIComponent(p)).join(",");
  return `${basePath}/api/download-batch?paths=${pathsParam}`;
}
