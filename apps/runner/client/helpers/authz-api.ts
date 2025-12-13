const BASE_URL = "/api/authz";

export interface SubjectMatch {
  claim?: {
    name: string;
    operator?: "contains" | "eq" | "gt" | "lt" | "neq" | "regex";
    value: boolean | number | string;
  };
  group?: string;
  id?: string;
  role?: string;
}

export interface ResourceMatch {
  app?: string;
  owner?: "self";
  path?: string;
  type?: string;
}

export interface ActionMatch {
  method?: string;
  operation?: string;
}

export interface Condition {
  after?: string;
  allowlist?: string[];
  before?: string;
  blocklist?: string[];
  cidr?: string;
  dayOfWeek?: number[];
  expression?: string;
  type: "custom" | "ip" | "time";
}

export interface Policy {
  actions: ActionMatch[];
  conditions?: Condition[];
  description?: string;
  effect: "deny" | "permit";
  id: string;
  name?: string;
  priority?: number;
  resources: ResourceMatch[];
  subjects: SubjectMatch[];
}

export interface EvaluationContext {
  action: {
    method: string;
    operation?: string;
  };
  environment: {
    ip: string;
    time: string;
    userAgent?: string;
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

export interface Decision {
  effect: "deny" | "indeterminate" | "not_applicable" | "permit";
  matchedPolicy?: string;
  reason?: string;
}

export interface ExplainResponse {
  context: EvaluationContext;
  decision: Decision;
  policies: Array<{
    effect: "deny" | "permit";
    id: string;
    name?: string;
    priority?: number;
  }>;
}

export const authzApi = {
  async listPolicies(): Promise<Policy[]> {
    const res = await fetch(`${BASE_URL}/policies`);
    if (!res.ok) throw new Error(`Failed to list policies: ${res.statusText}`);
    return res.json();
  },

  async getPolicy(id: string): Promise<Policy> {
    const res = await fetch(`${BASE_URL}/policies/${encodeURIComponent(id)}`);
    if (!res.ok) {
      if (res.status === 404) throw new Error("Policy not found");
      throw new Error(`Failed to get policy: ${res.statusText}`);
    }
    return res.json();
  },

  async createPolicy(policy: Policy): Promise<Policy> {
    const res = await fetch(`${BASE_URL}/policies`, {
      body: JSON.stringify(policy),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!res.ok) throw new Error(`Failed to create policy: ${res.statusText}`);
    return res.json();
  },

  async deletePolicy(id: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/policies/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      if (res.status === 404) throw new Error("Policy not found");
      throw new Error(`Failed to delete policy: ${res.statusText}`);
    }
  },

  async evaluate(context: EvaluationContext): Promise<Decision> {
    const res = await fetch(`${BASE_URL}/evaluate`, {
      body: JSON.stringify(context),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!res.ok) throw new Error(`Failed to evaluate: ${res.statusText}`);
    return res.json();
  },

  async explain(context: EvaluationContext): Promise<ExplainResponse> {
    const res = await fetch(`${BASE_URL}/explain`, {
      body: JSON.stringify(context),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!res.ok) throw new Error(`Failed to explain: ${res.statusText}`);
    return res.json();
  },
};
