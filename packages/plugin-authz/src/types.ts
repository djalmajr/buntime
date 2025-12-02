/**
 * Policy effect (XACML-like)
 */
export type Effect = "permit" | "deny";

/**
 * Policy combining algorithm
 */
export type CombiningAlgorithm =
  | "deny-overrides" // If any policy denies, deny
  | "permit-overrides" // If any policy permits, permit
  | "first-applicable"; // First matching policy decides

/**
 * Subject match (who)
 */
export interface SubjectMatch {
  /** Match specific user ID */
  id?: string;
  /** Match role (supports wildcards: "admin:*") */
  role?: string;
  /** Match group membership */
  group?: string;
  /** Match custom claim */
  claim?: {
    name: string;
    value: string | number | boolean;
    operator?: "eq" | "neq" | "gt" | "lt" | "contains" | "regex";
  };
}

/**
 * Resource match (what)
 */
export interface ResourceMatch {
  /** Match app name (supports wildcards) */
  app?: string;
  /** Match path pattern (supports wildcards and regex) */
  path?: string;
  /** Match resource type */
  type?: string;
  /** Match resource owner (subject owns resource) */
  owner?: "self";
}

/**
 * Action match (how)
 */
export interface ActionMatch {
  /** HTTP method (GET, POST, *, etc.) */
  method?: string;
  /** Custom operation name */
  operation?: string;
}

/**
 * Condition for policy evaluation
 */
export interface Condition {
  type: "time" | "ip" | "custom";

  // Time-based conditions
  after?: string; // ISO datetime or "HH:mm"
  before?: string;
  dayOfWeek?: number[]; // 0-6 (Sunday-Saturday)

  // IP-based conditions
  cidr?: string; // "192.168.1.0/24"
  allowlist?: string[];
  blocklist?: string[];

  // Custom expression
  expression?: string;
}

/**
 * Policy definition
 */
export interface Policy {
  /** Unique policy ID */
  id: string;
  /** Human-readable name */
  name?: string;
  /** Policy description */
  description?: string;
  /** Policy effect (permit or deny) */
  effect: Effect;
  /** Priority (higher = evaluated first) */
  priority?: number;

  /** Subject matching rules (who can access) */
  subjects: SubjectMatch[];
  /** Resource matching rules (what can be accessed) */
  resources: ResourceMatch[];
  /** Action matching rules (how it can be accessed) */
  actions: ActionMatch[];

  /** Additional conditions */
  conditions?: Condition[];
}

/**
 * Evaluation context
 */
export interface EvaluationContext {
  subject: {
    id: string;
    roles: string[];
    groups: string[];
    claims: Record<string, unknown>;
    [key: string]: unknown;
  };
  resource: {
    app: string;
    path: string;
    [key: string]: unknown;
  };
  action: {
    method: string;
    operation?: string;
  };
  environment: {
    ip: string;
    time: Date;
    userAgent?: string;
    [key: string]: unknown;
  };
}

/**
 * Authorization decision
 */
export interface Decision {
  effect: Effect | "not_applicable" | "indeterminate";
  reason?: string;
  matchedPolicy?: string;
}
