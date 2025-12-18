import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Icon,
  Input,
  Label,
} from "@buntime/shadcn-ui";
import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { useEffect, useState } from "react";

interface ProviderInfo {
  displayName: string;
  icon: string;
  providerId: string;
  type: "email-password" | "keycloak" | "auth0" | "okta" | "generic-oidc";
}

/**
 * Get display label for provider type
 */
function getProviderLabel(provider: ProviderInfo): string {
  switch (provider.type) {
    case "keycloak":
      return "Keycloak";
    case "auth0":
      return "Auth0";
    case "okta":
      return "Okta";
    case "generic-oidc":
      return provider.displayName; // Use displayName for generic OIDC
    case "email-password":
      return provider.displayName;
    default:
      return provider.displayName;
  }
}

/**
 * Get icon for provider type (known providers have specific icons)
 */
function getProviderIcon(provider: ProviderInfo): string {
  switch (provider.type) {
    case "keycloak":
      return "simple-icons:keycloak";
    case "auth0":
      return "simple-icons:auth0";
    case "okta":
      return "simple-icons:okta";
    case "email-password":
      return "lucide:mail";
    // case "generic-oidc":
    default:
      return provider.icon || "lucide:key-round";
  }
}

// Create auth client with genericOAuth plugin
const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/auth/api/auth",
  plugins: [genericOAuthClient()],
});

export function App() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);

  const redirect = new URLSearchParams(location.search).get("redirect") || "/";
  const urlError = new URLSearchParams(location.search).get("error");

  // Check if already authenticated and load providers
  useEffect(() => {
    Promise.all([authClient.getSession(), fetch("/auth/api/providers").then((r) => r.json())])
      .then(([sessionResult, providersData]) => {
        if (sessionResult.data?.user) {
          window.location.href = redirect;
          return;
        }
        setProviders(providersData);
        setProvidersLoading(false);
      })
      .catch(() => {
        setProvidersLoading(false);
      });
  }, [redirect]);

  const handleOAuthLogin = async (provider: ProviderInfo) => {
    setLoading(provider.providerId);
    setError(null);
    try {
      await authClient.signIn.oauth2({
        callbackURL: redirect,
        errorCallbackURL: `/auth/login?error=oauth&redirect=${encodeURIComponent(redirect)}`,
        providerId: provider.providerId,
      });
    } catch (err) {
      console.error("OAuth error:", err);
      setError("Authentication failed. Please try again.");
      setLoading(null);
    }
  };

  const handleEmailPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading("email-password");
    setError(null);

    try {
      const result = await authClient.signIn.email({
        email,
        password,
      });

      if (result.error) {
        setError(result.error.message || "Invalid email or password");
        setLoading(null);
        return;
      }

      window.location.href = redirect;
    } catch (err) {
      console.error("Email login error:", err);
      setError("Authentication failed. Please try again.");
      setLoading(null);
    }
  };

  if (providersLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Icon className="size-8 animate-spin text-muted-foreground" icon="lucide:loader-2" />
      </div>
    );
  }

  const emailPasswordProvider = providers.find((p) => p.type === "email-password");
  const oauthProviders = providers.filter((p) => p.type !== "email-password");
  const displayError = error || (urlError ? "Authentication failed. Please try again." : null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription>Sign in to continue</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {displayError && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <Icon className="mr-2 inline size-4" icon="lucide:alert-circle" />
              {displayError}
            </div>
          )}

          {/* Email/Password form */}
          {emailPasswordProvider && (
            <form className="space-y-4" onSubmit={handleEmailPasswordLogin}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  autoComplete="email"
                  disabled={loading !== null}
                  id="email"
                  placeholder="you@example.com"
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  autoComplete="current-password"
                  disabled={loading !== null}
                  id="password"
                  placeholder="••••••••"
                  required
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button className="w-full" disabled={loading !== null} size="lg" type="submit">
                {loading === "email-password" ? (
                  <>
                    <Icon className="mr-2 size-4 animate-spin" icon="lucide:loader-2" />
                    Signing in...
                  </>
                ) : (
                  <>
                    <Icon className="mr-2 size-4" icon={emailPasswordProvider.icon} />
                    Sign in with {emailPasswordProvider.displayName}
                  </>
                )}
              </Button>
            </form>
          )}

          {/* Divider if both email and OAuth */}
          {emailPasswordProvider && oauthProviders.length > 0 && (
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
              </div>
            </div>
          )}

          {/* OAuth providers */}
          {oauthProviders.map((provider) => (
            <Button
              className="w-full"
              disabled={loading !== null}
              key={provider.providerId}
              size="lg"
              variant={emailPasswordProvider ? "outline" : "default"}
              onClick={() => handleOAuthLogin(provider)}
            >
              {loading === provider.providerId ? (
                <>
                  <Icon className="mr-2 size-4 animate-spin" icon="lucide:loader-2" />
                  Redirecting...
                </>
              ) : (
                <>
                  <Icon className="mr-2 size-4" icon={getProviderIcon(provider)} />
                  Sign in with {getProviderLabel(provider)}
                </>
              )}
            </Button>
          ))}

          {/* No providers configured */}
          {providers.length === 0 && (
            <div className="text-center text-sm text-muted-foreground">
              No authentication providers configured.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
