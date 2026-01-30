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
  const baseHref = document.querySelector("base")?.getAttribute("href") || "/";
  return baseHref.replace(/\/$/, "") || "/authz";
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
