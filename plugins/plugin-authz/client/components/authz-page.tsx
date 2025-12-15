import { useEffect, useState } from "react";
import { EvaluateView } from "./evaluate-view";
import { OverviewView } from "./overview-view";
import { PoliciesView } from "./policies-view";

type View = "evaluate" | "overview" | "policies";

function getViewFromPath(pathname: string): View {
  if (pathname.endsWith("/evaluate")) return "evaluate";
  if (pathname.endsWith("/policies")) return "policies";
  return "overview";
}

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

export function AuthzPage() {
  const [currentView, setCurrentView] = useState<View>(() =>
    getViewFromPath(window.location.pathname),
  );

  useEffect(() => {
    const handlePopState = () => {
      setCurrentView(getViewFromPath(window.location.pathname));
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = (path: string) => {
    const basePath = getBasePath();
    const fullPath = `${basePath}${path}`;
    window.history.pushState({}, "", fullPath);
    setCurrentView(getViewFromPath(path));
  };

  return (
    <div className="h-full">
      {currentView === "overview" && <OverviewView onNavigate={navigate} />}
      {currentView === "policies" && <PoliciesView />}
      {currentView === "evaluate" && <EvaluateView />}
    </div>
  );
}
