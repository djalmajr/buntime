import { Icon } from "@iconify-icon/react";
import type Keycloak from "keycloak-js";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import type { CatalogApp } from "~/lib/config";
import { cn } from "~/utils/cn";

const FRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads";

interface ShellProps {
  catalog: CatalogApp[];
  keycloak: Keycloak;
}

export function Shell({ catalog, keycloak }: ShellProps) {
  const [active, setActive] = useState<CatalogApp | undefined>(catalog[0]);

  // Token relay: iframes (e.g. the platform UI) ask for the current access
  // token via postMessage; answer with the live Keycloak token.
  useEffect(() => {
    function onMessage(evt: MessageEvent) {
      const data = evt.data as { type?: string } | null;
      if (data?.type === "auth:request" && evt.source) {
        (evt.source as Window).postMessage({ type: "auth:token", token: keycloak.token }, "*");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [keycloak]);

  return (
    <div className="flex h-screen w-screen">
      <aside className="bg-sidebar text-sidebar-foreground flex w-60 shrink-0 flex-col border-r">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <span className="font-semibold">{keycloak.realm}</span>
          <Button size="icon-sm" variant="ghost" onClick={() => keycloak.logout()} title="Sign out">
            <Icon icon="lucide:log-out" />
          </Button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
          {catalog.length === 0 && (
            <p className="text-muted-foreground p-2 text-sm">No apps available.</p>
          )}
          {catalog.map((app) => (
            <button
              type="button"
              key={app.url}
              onClick={() => setActive(app)}
              className={cn(
                "hover:bg-sidebar-accent flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm",
                active?.url === app.url && "bg-sidebar-accent font-medium",
              )}
            >
              {app.icon && <Icon icon={app.icon} className="size-4" />}
              <span>{app.name}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex flex-1 flex-col">
        {active ? (
          <z-frame
            src={`${window.location.origin}${active.url}`}
            sandbox={FRAME_SANDBOX}
            style={{ display: "flex", flex: 1, height: "100%", width: "100%" }}
          />
        ) : (
          <div className="text-muted-foreground flex flex-1 items-center justify-center">
            Select an app
          </div>
        )}
      </main>
    </div>
  );
}
