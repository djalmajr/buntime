import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import manifest from "../../manifest.yaml";

const BASE = manifest.base;

/**
 * Same-origin fetch — the cpanel session cookie travels automatically,
 * so the runtime authenticates the request without any header injection.
 */
function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, credentials: "same-origin" });
}

export interface ProxyRule {
  base?: string;
  changeOrigin?: boolean;
  enabled?: boolean;
  headers?: Record<string, string>;
  id: string;
  name?: string;
  order?: number;
  pattern: string;
  readonly?: boolean;
  relativePaths?: boolean;
  rewrite?: string;
  secure?: boolean;
  target: string;
  ws?: boolean;
}

export interface ProxyRuleInput {
  base?: string;
  changeOrigin?: boolean;
  headers?: Record<string, string>;
  name?: string;
  pattern: string;
  relativePaths?: boolean;
  rewrite?: string;
  secure?: boolean;
  target: string;
  ws?: boolean;
}

export function useProxyRules() {
  return useQuery({
    queryFn: async () => {
      const res = await authFetch(`${BASE}/admin/rules`);
      if (!res.ok) throw new Error("Failed to fetch rules");
      return res.json() as Promise<ProxyRule[]>;
    },
    queryKey: ["proxy-rules"],
  });
}

export function useCreateProxyRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: ProxyRuleInput) => {
      const res = await authFetch(`${BASE}/admin/rules`, {
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to create rule");
      return res.json() as Promise<ProxyRule>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proxy-rules"] });
    },
  });
}

export function useUpdateProxyRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ data, id }: { data: Partial<ProxyRuleInput>; id: string }) => {
      const res = await authFetch(`${BASE}/admin/rules/${id}`, {
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      if (!res.ok) throw new Error("Failed to update rule");
      return res.json() as Promise<ProxyRule>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proxy-rules"] });
    },
  });
}

export function useDeleteProxyRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`${BASE}/admin/rules/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete rule");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proxy-rules"] });
    },
  });
}

export function useToggleProxyRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`${BASE}/admin/rules/${id}/toggle`, {
        method: "PATCH",
      });
      if (!res.ok) throw new Error("Failed to toggle rule");
      return res.json() as Promise<ProxyRule>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proxy-rules"] });
    },
  });
}

export function useReorderProxyRules() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await authFetch(`${BASE}/admin/rules/reorder`, {
        body: JSON.stringify({ ids }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      if (!res.ok) throw new Error("Failed to reorder rules");
      return res.json() as Promise<ProxyRule[]>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proxy-rules"] });
    },
  });
}
