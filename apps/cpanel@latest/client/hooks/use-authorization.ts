import { useQuery } from "@tanstack/react-query";
import { useAuth } from "~/contexts/auth-context";
import { getPluginBase } from "~/helpers/api-client";

interface UseAuthorizationOptions {
  action?: string;
  enabled?: boolean;
  method?: string;
  resource: string;
}

interface AuthorizationResult {
  isAllowed: boolean;
  isLoading: boolean;
}

interface EvaluationContext {
  action: {
    method: string;
    operation?: string;
  };
  environment: {
    ip: string;
    time: string;
  };
  resource: {
    app: string;
    path: string;
  };
  subject: {
    claims: Record<string, unknown>;
    groups: string[];
    id: string;
    roles: string[];
  };
}

interface Decision {
  effect: "permit" | "deny" | "not_applicable" | "indeterminate";
  matchedPolicy?: string;
  reason?: string;
}

/**
 * Hook to check user authorization for a specific resource/action
 *
 * @example
 * ```tsx
 * const { isAllowed, isLoading } = useAuthorization({
 *   resource: "/cpanel/settings",
 *   method: "GET",
 * });
 *
 * if (isLoading) return <Spinner />;
 * if (!isAllowed) return <AccessDenied />;
 * ```
 */
export function useAuthorization({
  action,
  enabled = true,
  method = "GET",
  resource,
}: UseAuthorizationOptions): AuthorizationResult {
  const auth = useAuth();

  const authorization$ = useQuery({
    enabled: enabled && !!auth,
    queryFn: async () => {
      if (!auth) return false;

      const context: EvaluationContext = {
        action: {
          method,
          operation: action,
        },
        environment: {
          ip: "0.0.0.0", // Server will inject real IP
          time: new Date().toISOString(),
        },
        resource: {
          app: "cpanel",
          path: resource,
        },
        subject: {
          claims: {},
          groups: [],
          id: auth.user.id,
          roles: [],
        },
      };

      const res = await fetch(`${getPluginBase("authz")}/api/evaluate`, {
        body: JSON.stringify(context),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!res.ok) {
        throw new Error("Failed to evaluate authorization");
      }

      const decision: Decision = await res.json();
      return decision.effect === "permit";
    },
    queryKey: ["authorization", resource, method, action, auth?.user.id],
    staleTime: 30_000, // Cache for 30 seconds
  });

  return {
    isAllowed: authorization$.data ?? false,
    isLoading: authorization$.isLoading,
  };
}
