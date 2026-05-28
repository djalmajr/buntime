/**
 * Tenant management API client (browser). The platform UI runs inside a z-frame
 * iframe hosted by apps/shell; the shell forwards the Keycloak access token via
 * postMessage (`{ type: "auth:token", token }`). For standalone/dev, a `?token=`
 * query param or `window.__token` is accepted as a fallback.
 *
 * Endpoints are relative to the worker mount (`/platform/api`), resolved from
 * the injected <base href>.
 */

import type { CatalogApp, TenantRecord } from "../types.ts";

let accessToken: string | undefined;

function bootstrapToken(): void {
  if (typeof window === "undefined") return;
  const fromGlobal = (window as { __token?: string }).__token;
  const fromQuery = new URLSearchParams(window.location.search).get("token");
  accessToken = fromGlobal ?? fromQuery ?? accessToken;

  // The shell (parent) pushes the token after Keycloak login / refresh.
  window.addEventListener("message", (evt: MessageEvent) => {
    const data = evt.data as { type?: string; token?: string } | null;
    if (data?.type === "auth:token" && typeof data.token === "string") {
      accessToken = data.token;
    }
  });
  // Ask the parent for the token on load (shell answers with auth:token).
  window.parent?.postMessage({ type: "auth:request" }, "*");
}

bootstrapToken();

export function setToken(token: string): void {
  accessToken = token;
}

function apiBase(): string {
  if (typeof document === "undefined") return "/platform/api";
  const base = document.querySelector("base")?.getAttribute("href") ?? "/platform/";
  return `${base.replace(/\/$/, "")}/api`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (init?.body) headers.set("Content-Type", "application/json");

  const res = await fetch(`${apiBase()}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface CreateTenantInput {
  slug: string;
  host: string;
  displayName?: string;
  catalog?: CatalogApp[];
}

export interface CreateTenantResponse {
  tenant: TenantRecord;
  credentials: { username: string; temporaryPassword: string };
}

export const tenantsApi = {
  list: () => request<TenantRecord[]>("/tenants"),
  create: (input: CreateTenantInput) =>
    request<CreateTenantResponse>("/tenants", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  remove: (slug: string) =>
    request<{ ok: boolean }>(`/tenants/${encodeURIComponent(slug)}`, { method: "DELETE" }),
};
