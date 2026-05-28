import "@zomme/frame"; // Registers the <z-frame> web component
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "~/components/shell";
import { fetchCatalog, getAuthConfig } from "~/lib/config";
import { initKeycloak } from "~/lib/keycloak";

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex h-screen w-screen items-center justify-center p-8 text-center">
      {children}
    </div>
  );
}

async function main() {
  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Root element not found");
  const root = createRoot(rootElement);

  const auth = getAuthConfig();
  if (!auth) {
    root.render(
      <Centered>
        This host is not configured. Ask an administrator to provision the tenant.
      </Centered>,
    );
    return;
  }

  root.render(<Centered>Signing in…</Centered>);

  try {
    const keycloak = await initKeycloak(auth);

    // Keep the token fresh; iframes pull the latest via the relay in <Shell>.
    keycloak.onTokenExpired = () => {
      keycloak.updateToken(30).catch(() => keycloak.login());
    };

    const catalog = await fetchCatalog();
    root.render(
      <StrictMode>
        <Shell catalog={catalog} keycloak={keycloak} />
      </StrictMode>,
    );
  } catch {
    root.render(<Centered>Authentication failed. Please reload to try again.</Centered>);
  }
}

void main();
