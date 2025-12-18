import { createContext, type ReactNode, useContext, useMemo } from "react";
import { getPluginBase } from "~/helpers/api-client";

export interface User {
  avatar?: string | null;
  email: string;
  id: string;
  name: string;
}

export interface Session {
  expiresAt: string;
  token: string;
  user: User;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  logout: () => Promise<void>;
  session: Session;
  user: User;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
  session: Session;
}

export function AuthProvider({ children, session }: AuthProviderProps) {
  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: true,
      logout: async () => {
        const authnBase = getPluginBase("@buntime/plugin-authn");
        // Redirect to home after OIDC logout - the auth hook will redirect to login if needed
        window.location.href = `${authnBase}/api/logout?redirect=/`;
      },
      session,
      user: session.user,
    }),
    [session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
