import { createAuthClient } from "better-auth/client";
import { hc } from "hono/client";
import { z } from "zod";
import type { AppType } from "@/server";

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const signUpSchema = signInSchema.extend({
  name: z.string().min(2),
});

// Get base path from <base> tag injected by runtime
const base = document.querySelector("base");
const basePath = base ? new URL(base.href).pathname.replace(/\/$/, "") : "";

// Hono client uses server's basePath from AppType, so only pass the app prefix
export const client = hc<AppType>(basePath || "/", {
  init: {
    credentials: "include",
  },
});

// BetterAuth requires absolute URL with full /api path
const authClient = createAuthClient({ baseURL: `${window.location.origin}${basePath}/api` });

// Session check for route guards (caches result for the request lifecycle)
let sessionPromise: Promise<Awaited<ReturnType<typeof client.api.auth.session.$get>> | null> | null =
  null;

export async function getSession() {
  if (!sessionPromise) {
    sessionPromise = client.api.auth.session
      .$get()
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
  }
  return sessionPromise;
}

export function clearSessionCache() {
  sessionPromise = null;
}

export const authApi = {
  signInWithEmail: async (credentials: z.infer<typeof signInSchema>) => {
    const { data, error } = await authClient.signIn.email(credentials);

    if (error) {
      throw error;
    }

    return data;
  },
  signUpWithEmail: async (credentials: z.infer<typeof signUpSchema>) => {
    const { data, error } = await authClient.signUp.email(credentials);

    if (error) {
      throw error;
    }

    return data;
  },
  signInWithGoogle: async () => {
    const { data, error } = await authClient.signIn.social({
      callbackURL: location.origin,
      provider: "google",
    });

    if (error) {
      throw new Error(`Failed to login: ${error.message}`);
    }

    if (data?.url) {
      window.location.href = data.url;
    }
  },
  logout: async () => {
    const res = await authClient.signOut();

    if (!res.data?.success) {
      throw new Error(res.error?.message ?? "Failed to logout");
    }

    return res.data;
  },
  session: async () => {
    const res = await client.api.auth.session.$get();

    if (res.status === 401) {
      return null;
    }

    if (!res.ok) {
      throw new Error("Failed to fetch session");
    }

    return res.json();
  },
};
