/**
 * Automatic plan resolution.
 * Ensures there is an active plan and decides between reuse/create.
 */

import type { Plan, TaskPlanConfig } from "../types";
import { activatePlan, createPlan, getActivePlan, getPlan, listPlans } from "./plan";

type EnsureReason =
  | "created_no_existing"
  | "reused_active"
  | "reused_matching"
  | "created_different_context"
  | "created_uncertain_context";

export interface EnsurePlanResult {
  plan: Plan;
  action: "created" | "reused";
  reason: EnsureReason;
  score?: number;
}

export function ensureActivePlan(
  projectDir: string,
  config: TaskPlanConfig,
  options?: { contextTitle?: string },
): EnsurePlanResult {
  const context = normalizeText(options?.contextTitle ?? "");
  const active = getActivePlan(projectDir, config);

  if (active) {
    if (!context) {
      return { plan: active, action: "reused", reason: "reused_active" };
    }

    const score = similarity(context, planText(active));
    if (score >= 0.72) {
      return { plan: active, action: "reused", reason: "reused_active", score };
    }
  }

  const candidates = listPlans(projectDir, config)
    .filter((plan) => plan.status === "In Progress" || plan.status === "Pending")
    .filter((plan) => !active || plan.id !== active.id);

  if (context && candidates.length > 0) {
    const match = bestMatch(context, candidates);

    if (match.score >= 0.72) {
      const reused = activatePlan(projectDir, config, match.plan.id) || match.plan;
      return {
        plan: reused,
        action: "reused",
        reason: "reused_matching",
        score: match.score,
      };
    }

    if (match.score <= 0.35) {
      const created = createAndActivate(projectDir, config, context);
      return {
        plan: created,
        action: "created",
        reason: "created_different_context",
        score: match.score,
      };
    }

    const created = createAndActivate(projectDir, config, context);
    return {
      plan: created,
      action: "created",
      reason: "created_uncertain_context",
      score: match.score,
    };
  }

  if (!active) {
    const created = createAndActivate(projectDir, config, context);
    return {
      plan: created,
      action: "created",
      reason: "created_no_existing",
    };
  }

  return { plan: active, action: "reused", reason: "reused_active" };
}

function createAndActivate(projectDir: string, config: TaskPlanConfig, context: string): Plan {
  const title = context ? `Auto plan: ${truncate(context, 64)}` : "Auto plan";
  const id = generatePlanId(projectDir, config, context || "auto-plan");
  const summary = context
    ? `Automatically generated plan for: ${truncate(context, 120)}`
    : "Automatically generated plan for the current session.";
  const description = buildDescription(context);
  const tasks = [
    "Inspect current code and requirements",
    "Implement the requested changes",
    "Run validation checks and review output",
  ];

  createPlan(projectDir, config, id, title, summary, description, tasks);
  return activatePlan(projectDir, config, id) || getPlan(projectDir, config, id)!;
}

function buildDescription(context: string): string {
  return [
    "## Context",
    context || "Work requested during this session.",
    "",
    "## Scope",
    "Include only the requested implementation and required verification.",
    "",
    "## Approach",
    "Analyze existing code, implement with minimal safe changes, then validate.",
    "",
    "## Acceptance Criteria",
    "- Requested behavior is implemented",
    "- Relevant checks run successfully or are explicitly reported",
  ].join("\n");
}

function bestMatch(context: string, plans: Plan[]): { plan: Plan; score: number } {
  let best = plans[0];
  let bestScore = similarity(context, planText(plans[0]));

  for (const plan of plans.slice(1)) {
    const score = similarity(context, planText(plan));
    if (score > bestScore) {
      best = plan;
      bestScore = score;
    }
  }

  return { plan: best, score: bestScore };
}

function planText(plan: Plan): string {
  return normalizeText(`${plan.title} ${plan.summary} ${plan.description}`);
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;

  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap++;
  }

  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : overlap / union;
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function generatePlanId(projectDir: string, config: TaskPlanConfig, context: string): string {
  const base = toKebab(context || "auto-plan").slice(0, 40) || "auto-plan";
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 12);
  let id = `${base}-${stamp}`;
  let suffix = 1;

  while (getPlan(projectDir, config, id)) {
    suffix += 1;
    id = `${base}-${stamp}-${suffix}`;
  }

  return id;
}

function toKebab(text: string): string {
  return normalizeText(text).replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}
