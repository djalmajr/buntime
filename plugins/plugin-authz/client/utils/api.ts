function getApiBase(): string {
  const baseHref = document.querySelector("base")?.getAttribute("href") || "/";
  return baseHref.replace(/\/$/, "") || "/authz";
}

export const basePath = getApiBase();
