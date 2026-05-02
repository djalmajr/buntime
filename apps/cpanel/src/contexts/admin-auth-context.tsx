import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { AdminSession, ApiPermission } from "~/helpers/admin-api";
import { getAdminSession, hasPermission } from "~/helpers/admin-api";

const STORAGE_KEY = "buntime:admin-api-key";

type AdminAuthStatus = "authenticated" | "checking" | "unauthenticated";

interface AdminAuthContextValue {
  apiKey: string | null;
  authenticate: (apiKey: string) => Promise<AdminSession>;
  can: (permission: ApiPermission) => boolean;
  logout: () => void;
  refresh: () => Promise<AdminSession | null>;
  session: AdminSession | null;
  status: AdminAuthStatus;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

function readStoredApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(STORAGE_KEY);
}

function storeApiKey(apiKey: string | null): void {
  if (typeof window === "undefined") return;

  if (apiKey) {
    window.sessionStorage.setItem(STORAGE_KEY, apiKey);
  } else {
    window.sessionStorage.removeItem(STORAGE_KEY);
  }
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKey] = useState<string | null>(() => readStoredApiKey());
  const [session, setSession] = useState<AdminSession | null>(null);
  const [status, setStatus] = useState<AdminAuthStatus>(() =>
    readStoredApiKey() ? "checking" : "unauthenticated",
  );

  const logout = useCallback(() => {
    storeApiKey(null);
    setApiKey(null);
    setSession(null);
    setStatus("unauthenticated");
  }, []);

  const authenticate = useCallback(async (nextApiKey: string) => {
    const trimmed = nextApiKey.trim();
    const nextSession = await getAdminSession(trimmed);

    storeApiKey(trimmed);
    setApiKey(trimmed);
    setSession(nextSession);
    setStatus("authenticated");

    return nextSession;
  }, []);

  const refresh = useCallback(async () => {
    if (!apiKey) {
      setSession(null);
      setStatus("unauthenticated");
      return null;
    }

    setStatus("checking");
    try {
      const nextSession = await getAdminSession(apiKey);
      setSession(nextSession);
      setStatus("authenticated");
      return nextSession;
    } catch (err) {
      logout();
      throw err;
    }
  }, [apiKey, logout]);

  useEffect(() => {
    if (!apiKey) {
      setStatus("unauthenticated");
      return;
    }

    let active = true;
    setStatus("checking");

    getAdminSession(apiKey)
      .then((nextSession) => {
        if (!active) return;
        setSession(nextSession);
        setStatus("authenticated");
      })
      .catch(() => {
        if (!active) return;
        logout();
      });

    return () => {
      active = false;
    };
  }, [apiKey, logout]);

  const value = useMemo<AdminAuthContextValue>(
    () => ({
      apiKey,
      authenticate,
      can: (permission) => hasPermission(session, permission),
      logout,
      refresh,
      session,
      status,
    }),
    [apiKey, authenticate, logout, refresh, session, status],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (!context) {
    throw new Error("useAdminAuth must be used within AdminAuthProvider");
  }
  return context;
}
