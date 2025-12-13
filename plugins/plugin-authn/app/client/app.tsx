import { useState } from "react";
import { createAuthClient } from "better-auth/react";
import { genericOAuthClient } from "better-auth/client/plugins";
import { cn } from "./utils";

// Create auth client with genericOAuth plugin
const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/auth/api",
  plugins: [genericOAuthClient()],
});

export function App() {
  const [loading, setLoading] = useState(false);
  const redirect = new URLSearchParams(location.search).get("redirect") || "/";

  const handleLogin = async () => {
    setLoading(true);
    try {
      await authClient.signIn.oauth2({
        providerId: "keycloak",
        callbackURL: redirect,
        errorCallbackURL: "/auth/login?error=oauth",
      });
    } catch (error) {
      console.error("OAuth error:", error);
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-800 p-8 shadow-xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-white">Login</h1>
          <p className="mt-2 text-sm text-slate-400">Sign in to continue</p>
        </div>
        <button
          className={cn(
            "w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white",
            "hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "transition-colors",
          )}
          disabled={loading}
          type="button"
          onClick={handleLogin}
        >
          {loading ? "Redirecting..." : "Sign in with Keycloak"}
        </button>
      </div>
    </div>
  );
}
