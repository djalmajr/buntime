import { useRouter } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { authApi } from "~/lib/api";
import type { SignInCredentials, SignUpCredentials } from "~/schemas/auth";

export type AuthSession = NonNullable<Awaited<ReturnType<typeof authApi.session>>>;

interface AuthContextType {
  session: AuthSession | null;
  isLoading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (credentials: SignInCredentials) => Promise<void>;
  signUpWithEmail: (credentials: SignUpCredentials) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const signInWithGoogle = async () => {
    await authApi.signInWithGoogle();
  };

  const signInWithEmail = async (credentials: SignInCredentials) => {
    await authApi.signInWithEmail(credentials);
    router.invalidate();
  };

  const signUpWithEmail = async (credentials: SignUpCredentials) => {
    await authApi.signUpWithEmail(credentials);
    router.invalidate();
  };

  const logout = async () => {
    await authApi.logout();
    router.invalidate();
  };

  useEffect(() => {
    authApi
      .session()
      .then((data) => setSession(data))
      .catch(() => setSession(null))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        isLoading,
        signInWithGoogle,
        signInWithEmail,
        signUpWithEmail,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
};
