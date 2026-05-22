import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { AdminSession, ApiPermission } from "~/helpers/admin-api";
import {
  getAdminSession,
  hasPermission,
  loginAdminSession,
  logoutAdminSession,
} from "~/helpers/admin-api";

type ApiKeyAuthStatus = "authenticated" | "checking" | "unauthenticated";

interface ApiKeyAuthContextValue {
  authenticate: (apiKey: string) => Promise<AdminSession>;
  can: (permission: ApiPermission) => boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<AdminSession | null>;
  session: AdminSession | null;
  status: ApiKeyAuthStatus;
}

const ApiKeyAuthContext = createContext<ApiKeyAuthContextValue | null>(null);

/**
 * React context for the cpanel session.
 *
 * **No JavaScript-readable credentials.** Authentication is bound to the
 * HttpOnly `buntime_api_key` cookie issued by `POST /api/admin/session`. The
 * provider only exposes the principal (role + permissions) and lifecycle
 * methods. The raw API key never enters React state, sessionStorage, or any
 * other JS-reachable surface — XSS cannot exfiltrate it.
 *
 * On mount the provider probes `GET /api/admin/session`; if the cookie is
 * present the browser sends it and the runtime returns the principal.
 */
export function ApiKeyAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [status, setStatus] = useState<ApiKeyAuthStatus>("checking");

  const logout = useCallback(async () => {
    try {
      await logoutAdminSession();
    } finally {
      setSession(null);
      setStatus("unauthenticated");
    }
  }, []);

  const authenticate = useCallback(async (nextApiKey: string) => {
    const trimmed = nextApiKey.trim();
    const nextSession = await loginAdminSession(trimmed);
    setSession(nextSession);
    setStatus("authenticated");
    return nextSession;
  }, []);

  const refresh = useCallback(async () => {
    setStatus("checking");
    try {
      const nextSession = await getAdminSession();
      setSession(nextSession);
      setStatus("authenticated");
      return nextSession;
    } catch {
      setSession(null);
      setStatus("unauthenticated");
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    getAdminSession()
      .then((nextSession) => {
        if (!active) return;
        setSession(nextSession);
        setStatus("authenticated");
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
        setStatus("unauthenticated");
      });

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<ApiKeyAuthContextValue>(
    () => ({
      authenticate,
      can: (permission) => hasPermission(session, permission),
      logout,
      refresh,
      session,
      status,
    }),
    [authenticate, logout, refresh, session, status],
  );

  return <ApiKeyAuthContext.Provider value={value}>{children}</ApiKeyAuthContext.Provider>;
}

export function useApiKey() {
  const context = useContext(ApiKeyAuthContext);
  if (!context) {
    throw new Error("useApiKey must be used within ApiKeyAuthProvider");
  }
  return context;
}

export type { ApiKeyAuthStatus };
