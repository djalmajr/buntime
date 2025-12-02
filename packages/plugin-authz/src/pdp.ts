import type {
  ActionMatch,
  CombiningAlgorithm,
  Condition,
  Decision,
  Effect,
  EvaluationContext,
  Policy,
  ResourceMatch,
  SubjectMatch,
} from "./types";

/**
 * Policy Decision Point (PDP)
 * Evaluates policies against a given context and returns a decision.
 */
export class PolicyDecisionPoint {
  constructor(
    private combiningAlgorithm: CombiningAlgorithm = "deny-overrides",
    private defaultEffect: Effect = "deny",
  ) {}

  /**
   * Evaluate policies against context
   */
  evaluate(context: EvaluationContext, policies: Policy[]): Decision {
    // Sort by priority (higher first)
    const sorted = [...policies].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    const results: Array<{ policy: Policy; decision: Decision }> = [];

    for (const policy of sorted) {
      if (this.matchesPolicy(policy, context)) {
        const decision = this.evaluatePolicy(policy, context);
        results.push({ policy, decision });

        // First-applicable: stop at first match
        if (
          this.combiningAlgorithm === "first-applicable" &&
          decision.effect !== "not_applicable"
        ) {
          return decision;
        }
      }
    }

    return this.combineDecisions(results);
  }

  private matchesPolicy(policy: Policy, context: EvaluationContext): boolean {
    return (
      this.matchSubjects(policy.subjects, context.subject) &&
      this.matchResources(policy.resources, context.resource) &&
      this.matchActions(policy.actions, context.action)
    );
  }

  private matchSubjects(subjects: SubjectMatch[], subject: EvaluationContext["subject"]): boolean {
    if (subjects.length === 0) return true; // No subject restriction

    return subjects.some((s) => this.matchSubject(s, subject));
  }

  private matchSubject(match: SubjectMatch, subject: EvaluationContext["subject"]): boolean {
    // Match by ID
    if (match.id && match.id !== subject.id) {
      return false;
    }

    // Match by role (supports wildcards)
    if (match.role) {
      const pattern = match.role.replace(/\*/g, ".*");
      const regex = new RegExp(`^${pattern}$`);
      if (!subject.roles.some((r) => regex.test(r))) {
        return false;
      }
    }

    // Match by group
    if (match.group && !subject.groups.includes(match.group)) {
      return false;
    }

    // Match by claim
    if (match.claim) {
      const value = subject.claims[match.claim.name];
      if (!this.matchClaimValue(value, match.claim.value, match.claim.operator ?? "eq")) {
        return false;
      }
    }

    return true;
  }

  private matchClaimValue(
    actual: unknown,
    expected: string | number | boolean,
    operator: string,
  ): boolean {
    switch (operator) {
      case "eq":
        return actual === expected;
      case "neq":
        return actual !== expected;
      case "gt":
        return typeof actual === "number" && actual > (expected as number);
      case "lt":
        return typeof actual === "number" && actual < (expected as number);
      case "contains":
        return typeof actual === "string" && actual.includes(expected as string);
      case "regex":
        return typeof actual === "string" && new RegExp(expected as string).test(actual);
      default:
        return false;
    }
  }

  private matchResources(
    resources: ResourceMatch[],
    resource: EvaluationContext["resource"],
  ): boolean {
    if (resources.length === 0) return true; // No resource restriction

    return resources.some((r) => this.matchResource(r, resource));
  }

  private matchResource(match: ResourceMatch, resource: EvaluationContext["resource"]): boolean {
    // Match by app (supports wildcards)
    if (match.app) {
      const pattern = match.app.replace(/\*/g, ".*");
      const regex = new RegExp(`^${pattern}$`);
      if (!regex.test(resource.app)) {
        return false;
      }
    }

    // Match by path (supports wildcards)
    if (match.path) {
      const pattern = match.path.replace(/\*/g, ".*");
      const regex = new RegExp(`^${pattern}$`);
      if (!regex.test(resource.path)) {
        return false;
      }
    }

    // Match by type
    if (match.type && resource.type !== match.type) {
      return false;
    }

    return true;
  }

  private matchActions(actions: ActionMatch[], action: EvaluationContext["action"]): boolean {
    if (actions.length === 0) return true; // No action restriction

    return actions.some((a) => this.matchAction(a, action));
  }

  private matchAction(match: ActionMatch, action: EvaluationContext["action"]): boolean {
    // Match by method (supports wildcards)
    if (match.method) {
      if (match.method !== "*" && match.method.toUpperCase() !== action.method.toUpperCase()) {
        return false;
      }
    }

    // Match by operation
    if (match.operation && match.operation !== action.operation) {
      return false;
    }

    return true;
  }

  private evaluatePolicy(policy: Policy, context: EvaluationContext): Decision {
    // Check conditions
    if (policy.conditions) {
      for (const condition of policy.conditions) {
        if (!this.evaluateCondition(condition, context)) {
          return {
            effect: "not_applicable",
            reason: "Condition not met",
            matchedPolicy: policy.id,
          };
        }
      }
    }

    return {
      effect: policy.effect,
      reason: policy.description,
      matchedPolicy: policy.id,
    };
  }

  private evaluateCondition(condition: Condition, context: EvaluationContext): boolean {
    switch (condition.type) {
      case "time":
        return this.evaluateTimeCondition(condition, context.environment.time);
      case "ip":
        return this.evaluateIpCondition(condition, context.environment.ip);
      case "custom":
        // Custom expressions would need a safe evaluator
        return true;
      default:
        return true;
    }
  }

  private evaluateTimeCondition(condition: Condition, time: Date): boolean {
    const hours = time.getHours();
    const minutes = time.getMinutes();
    const currentTime = hours * 60 + minutes;

    // Check after/before (HH:mm format)
    if (condition.after) {
      const [h, m] = condition.after.split(":").map(Number);
      const afterTime = (h ?? 0) * 60 + (m ?? 0);
      if (currentTime < afterTime) return false;
    }

    if (condition.before) {
      const [h, m] = condition.before.split(":").map(Number);
      const beforeTime = (h ?? 0) * 60 + (m ?? 0);
      if (currentTime >= beforeTime) return false;
    }

    // Check day of week
    if (condition.dayOfWeek && !condition.dayOfWeek.includes(time.getDay())) {
      return false;
    }

    return true;
  }

  private evaluateIpCondition(condition: Condition, ip: string): boolean {
    // Check allowlist
    if (condition.allowlist && !condition.allowlist.includes(ip)) {
      return false;
    }

    // Check blocklist
    if (condition.blocklist && condition.blocklist.includes(ip)) {
      return false;
    }

    // CIDR matching would require IP parsing
    // Simplified: skip CIDR for now

    return true;
  }

  private combineDecisions(results: Array<{ policy: Policy; decision: Decision }>): Decision {
    if (results.length === 0) {
      return { effect: this.defaultEffect, reason: "No applicable policy" };
    }

    switch (this.combiningAlgorithm) {
      case "deny-overrides": {
        const deny = results.find((r) => r.decision.effect === "deny");
        if (deny) return deny.decision;

        const permit = results.find((r) => r.decision.effect === "permit");
        if (permit) return permit.decision;

        return { effect: this.defaultEffect, reason: "No permit or deny decision" };
      }

      case "permit-overrides": {
        const permit = results.find((r) => r.decision.effect === "permit");
        if (permit) return permit.decision;

        const deny = results.find((r) => r.decision.effect === "deny");
        if (deny) return deny.decision;

        return { effect: this.defaultEffect, reason: "No permit or deny decision" };
      }

      case "first-applicable":
      default: {
        const applicable = results.find(
          (r) => r.decision.effect === "permit" || r.decision.effect === "deny",
        );
        return (
          applicable?.decision ?? { effect: this.defaultEffect, reason: "No applicable policy" }
        );
      }
    }
  }
}
