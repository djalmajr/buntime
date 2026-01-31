import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import manifest from "../../manifest.jsonc";

export interface ProxyRule {
  base?: string;
  changeOrigin?: boolean;
  headers?: Record<string, string>;
  id: string;
  name?: string;
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
      const res = await fetch(`${manifest.base}/api/rules`);
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
      const res = await fetch(`${manifest.base}/api/rules`, {
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
      const res = await fetch(`${manifest.base}/api/rules/${id}`, {
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
      const res = await fetch(`${manifest.base}/api/rules/${id}`, {
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
