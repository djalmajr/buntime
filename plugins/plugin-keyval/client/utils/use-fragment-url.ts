import { useEffect, useState } from "react";

function getBasePath(): string {
  const outlet = document.querySelector("piercing-fragment-outlet[data-fragment-base]");
  if (outlet) {
    const fragmentBase = outlet.getAttribute("data-fragment-base");
    if (fragmentBase) {
      return fragmentBase.replace(/\/$/, "");
    }
  }

  const base = document.querySelector("base");
  if (base) {
    const href = base.getAttribute("href") || "";
    return href.replace(/\/$/, "");
  }
  return "";
}

export function useFragmentUrl() {
  const [path, setPath] = useState("");
  const basePath = getBasePath();

  useEffect(() => {
    const updatePath = () => {
      const fullPath = window.location.pathname;
      const base = basePath || "";
      if (fullPath.startsWith(base)) {
        const relativePath = fullPath.slice(base.length).replace(/^\//, "");
        setPath(relativePath);
      } else {
        setPath("");
      }
    };

    updatePath();

    window.addEventListener("popstate", updatePath);
    return () => window.removeEventListener("popstate", updatePath);
  }, [basePath]);

  const navigate = (newPath: string) => {
    const fullPath = basePath ? `${basePath}/${newPath.replace(/^\//, "")}` : `/${newPath}`;
    window.history.pushState(null, "", fullPath);
    setPath(newPath.replace(/^\//, ""));
  };

  return { basePath, navigate, path };
}
