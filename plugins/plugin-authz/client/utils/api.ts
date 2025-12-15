function getBasePath(): string {
  // First, try to get base from piercing-fragment-outlet's data attribute
  // This is set when the fragment is loaded inside a shell (e.g., cpanel)
  const outlet = document.querySelector("piercing-fragment-outlet[data-fragment-base]");
  if (outlet) {
    const fragmentBase = outlet.getAttribute("data-fragment-base");
    if (fragmentBase) {
      return fragmentBase.replace(/\/$/, "");
    }
  }

  // Fall back to document's base tag (for standalone mode at /p/authz)
  const base = document.querySelector("base");
  if (base) {
    const href = base.getAttribute("href") || "";
    return href.replace(/\/$/, "");
  }
  return "";
}

export const basePath = getBasePath();
