import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Plugin context type (resolved by OpenCode at runtime)
interface PluginContext {
  client: {
    app: {
      log: (opts: { service: string; level: string; message: string }) => Promise<void>;
    };
  };
  directory: string;
}

// =============================================================================
// Types
// =============================================================================

interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  line: number;
}

interface PlanningState {
  activePlan: {
    file: string;
    startedAt: string;
    checklistItems: ChecklistItem[];
  } | null;
  pendingPlans: string[];
  completedPlans: {
    file: string;
    completedAt: string;
  }[];
}

interface PlanValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface RuleSummary {
  file: string;
  name: string;
  summary: string;
}

// =============================================================================
// Constants
// =============================================================================

const STATE_FILE = ".opencode/planning-state.json";
const PLANS_DIR = ".opencode/plans";
const RULES_DIR = ".opencode/rules";

/** Files/paths that don't require a plan to be modified */
const PLAN_EXEMPT_PATTERNS = [
  /\.http$/, // HTTP request files (REST Client)
  /\.spec\.(ts|js|tsx|jsx)$/, // Spec files
  /\.test\.(ts|js|tsx|jsx)$/, // Test files
  /^\.claude\//, // Claude config
  /^\.env/, // Environment files
  /^\.gitignore$/, // Gitignore
  /^\.opencode\//, // OpenCode config (includes plans/)
  /^README\.md$/, // README
];

/** Git commands that are blocked */
const BLOCKED_GIT = [/git\s+(commit|add|push|stash|reset\s+--hard|rebase|merge|cherry-pick)/i];

/** Git commands that are allowed */
const ALLOWED_GIT = [/git\s+(status|diff|log|branch|show|ls-files|checkout\s+-b)/i];

// =============================================================================
// Planning Enforcer Plugin
// =============================================================================

/**
 * Planning Enforcer Plugin
 *
 * 1. Loads summaries from .opencode/rules/*.md frontmatter
 * 2. Blocks modifications without an active plan
 * 3. Validates plan format and reactivation
 * 4. Syncs TodoWrite ↔ Plan checklist (1:1)
 * 5. Warns about files not in plan
 * 6. Blocks dangerous git operations
 */
export const PlanningEnforcer = async ({ client, directory }: PluginContext) => {
  let testsExecuted = false;

  // ===========================================================================
  // State Management
  // ===========================================================================

  const loadState = (): PlanningState => {
    try {
      const path = join(directory, STATE_FILE);
      if (existsSync(path)) {
        return JSON.parse(readFileSync(path, "utf-8"));
      }
    } catch {
      // Ignore errors, return default state
    }
    return { activePlan: null, pendingPlans: [], completedPlans: [] };
  };

  const saveState = (state: PlanningState) => {
    const path = join(directory, STATE_FILE);
    writeFileSync(path, JSON.stringify(state, null, 2));
  };

  // ===========================================================================
  // Plan Parsing
  // ===========================================================================

  /** Generate an 8-char hash from text (human-readable ID) */
  const hash8 = (text: string): string => {
    let h1 = 5381;
    let h2 = 52711;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = (h1 * 33) ^ c;
      h2 = (h2 * 33) ^ c;
    }
    // Combine both hashes for better distribution
    const combined = (Math.abs(h1) * 31 + Math.abs(h2)) >>> 0;
    return combined.toString(36).slice(0, 8).padStart(8, "0");
  };

  /** Extract file paths from checklist item text (from backticks) */
  const extractFilesFromItem = (text: string): string[] => {
    const regex = /`([^`]+\.(ts|js|tsx|jsx|json|yaml|yml|md))`/g;
    const files: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      files.push(match[1]);
    }
    return files;
  };

  /** Get all expected files from active plan's checklist */
  const getExpectedFiles = (state: PlanningState): string[] => {
    if (!state.activePlan) return [];

    return state.activePlan.checklistItems
      .flatMap((item) => extractFilesFromItem(item.text))
      .filter((f, i, arr) => arr.indexOf(f) === i); // unique
  };

  /** Parse checklist items from plan content */
  const parseChecklist = (content: string): ChecklistItem[] => {
    const lines = content.split("\n");
    const items: ChecklistItem[] = [];

    lines.forEach((line, index) => {
      // Match checklist items: - [ ] or - [x]
      const match = line.match(/^(\s*)-\s*\[([ x])\]\s*(.+)$/);
      if (match) {
        const completed = match[2] === "x";
        const text = match[3].trim();

        items.push({
          id: hash8(text),
          text,
          completed,
          line: index + 1,
        });
      }
    });

    return items;
  };

  /** Parse plan status from content */
  const parsePlanStatus = (content: string): "Pending" | "In Progress" | "Done" | null => {
    const match = content.match(/\*\*Status:\*\*\s*(Pending|In Progress|Done)/);
    return match ? (match[1] as "Pending" | "In Progress" | "Done") : null;
  };

  // ===========================================================================
  // Plan Validation
  // ===========================================================================

  /** Validate plan format */
  const validatePlanFormat = (content: string): PlanValidation => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required: Status field
    if (!content.includes("**Status:**")) {
      errors.push("Missing **Status:** field");
    }

    // Required: At least one pending task
    const pendingTasks = (content.match(/- \[ \]/g) || []).length;
    if (pendingTasks === 0) {
      errors.push("Plan must have at least one pending task (- [ ])");
    }

    // Recommended: Objective section
    if (!content.match(/## (Objective|Objetivo)/i)) {
      warnings.push("Consider adding ## Objective section");
    }

    // Check task granularity (warn if tasks seem too broad)
    const tasks = [...content.matchAll(/- \[ \] (.+)/g)].map((m) => m[1]);
    const broadTasks = tasks.filter(
      (t) =>
        t.length < 20 || // Very short
        (!t.includes("`") && !t.match(/\.(ts|js|json|yaml)/)), // No file reference
    );

    if (broadTasks.length > 0 && broadTasks.length === tasks.length) {
      warnings.push(
        "Tasks seem broad. Consider making them more granular:\n" +
          "  - Include specific file names in backticks\n" +
          "  - Break large tasks into smaller steps",
      );
    }

    return { valid: errors.length === 0, errors, warnings };
  };

  /** Validate plan reactivation (Done → In Progress) */
  const validatePlanReactivation = (
    planFile: string,
    oldContent: string,
    newContent: string,
  ): { allowed: boolean; reason: string } => {
    const oldStatus = parsePlanStatus(oldContent);
    const newStatus = parsePlanStatus(newContent);

    // Not a reactivation
    if (oldStatus !== "Done" || newStatus !== "In Progress") {
      return { allowed: true, reason: "" };
    }

    // Reactivation: Done → In Progress
    const newChecklist = parseChecklist(newContent);
    const hasPendingTasks = newChecklist.some((item) => !item.completed);

    // Case 1: Has pending tasks → ALLOW (adjustments)
    if (hasPendingTasks) {
      const pendingCount = newChecklist.filter((i) => !i.completed).length;
      return {
        allowed: true,
        reason: `Plan "${planFile}" reactivated with ${pendingCount} pending task(s).`,
      };
    }

    // Case 2: Same files as before → ALLOW (fixes)
    const oldChecklist = parseChecklist(oldContent);
    const oldFiles = oldChecklist.flatMap((i) => extractFilesFromItem(i.text));
    const newFiles = newChecklist.flatMap((i) => extractFilesFromItem(i.text));

    const sameFiles =
      oldFiles.length > 0 &&
      newFiles.length > 0 &&
      newFiles.every((f) => oldFiles.includes(f)) &&
      oldFiles.every((f) => newFiles.includes(f));

    if (sameFiles) {
      return {
        allowed: true,
        reason: `Plan "${planFile}" reactivated for adjustments to same files.`,
      };
    }

    // Case 3: Different files without pending tasks → BLOCK
    return {
      allowed: false,
      reason:
        `Cannot reactivate completed plan for different scope.\n\n` +
        `The completed plan worked on:\n` +
        oldFiles.map((f) => `  - ${f}`).join("\n") +
        `\n\nTo work on different files, create a new plan with pending tasks.`,
    };
  };

  // ===========================================================================
  // Plan ↔ Todo Sync
  // ===========================================================================

  /** Sync todo completion to plan checklist */
  const syncTodoToPlan = (todoContent: string, completed: boolean) => {
    const state = loadState();
    if (!state.activePlan) return;

    const item = state.activePlan.checklistItems.find((i) => i.text === todoContent);
    if (!item || item.completed === completed) return;

    // Read plan content
    const planPath = join(directory, state.activePlan.file);
    if (!existsSync(planPath)) return;

    const content = readFileSync(planPath, "utf-8");
    const lines = content.split("\n");

    // Update the specific line
    const lineIndex = item.line - 1;
    if (lineIndex < 0 || lineIndex >= lines.length) return;

    const currentLine = lines[lineIndex];

    if (completed) {
      lines[lineIndex] = currentLine.replace("- [ ]", "- [x]");
    } else {
      lines[lineIndex] = currentLine.replace("- [x]", "- [ ]");
    }

    // Write back
    writeFileSync(planPath, lines.join("\n"));

    // Update state
    item.completed = completed;
    saveState(state);
  };

  // ===========================================================================
  // Rules Loading
  // ===========================================================================

  /** Parse YAML frontmatter from markdown content */
  const parseFrontmatter = (content: string): { name?: string; summary?: string } | null => {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    const yaml = match[1];
    const nameMatch = yaml.match(/^name:\s*(.+)$/m);

    // Handle multiline summary with | or direct string
    let summary: string | undefined;
    const summaryBlockMatch = yaml.match(/^summary:\s*\|\n([\s\S]*?)(?=\n[a-z]|\n---|\s*$)/m);
    const summaryInlineMatch = yaml.match(/^summary:\s*["']?([^"'\n]+)["']?$/m);

    if (summaryBlockMatch) {
      summary = summaryBlockMatch[1].replace(/^ {2}/gm, "").trim();
    } else if (summaryInlineMatch) {
      summary = summaryInlineMatch[1].trim();
    }

    return {
      name: nameMatch?.[1]?.trim(),
      summary,
    };
  };

  /** Scan .opencode/rules/ and validate frontmatter */
  const scanRulesDirectory = (): { valid: RuleSummary[]; invalid: string[] } => {
    const rulesDir = join(directory, RULES_DIR);
    if (!existsSync(rulesDir)) return { valid: [], invalid: [] };

    const valid: RuleSummary[] = [];
    const invalid: string[] = [];

    const files = readdirSync(rulesDir).filter((f) => f.endsWith(".md"));

    for (const file of files) {
      try {
        const content = readFileSync(join(rulesDir, file), "utf-8");
        const frontmatter = parseFrontmatter(content);

        if (frontmatter?.summary) {
          valid.push({
            file,
            name: frontmatter.name || file.replace(".md", ""),
            summary: frontmatter.summary,
          });
        } else {
          invalid.push(file);
        }
      } catch {
        invalid.push(file);
      }
    }

    return { valid, invalid };
  };

  // ===========================================================================
  // Helper Functions
  // ===========================================================================

  /** Check if a file path is exempt from plan requirement */
  const isExemptFromPlan = (filePath: string): boolean => {
    const relativePath = filePath.replace(directory + "/", "");
    return PLAN_EXEMPT_PATTERNS.some((p) => p.test(relativePath));
  };

  /** Check if this is a write/edit operation */
  const isWriteOperation = (tool: string): boolean => {
    return ["write", "mcp_write", "edit", "mcp_edit"].includes(tool);
  };

  /** Check if git command is blocked */
  const isBlockedGit = (cmd: string): boolean => {
    if (ALLOWED_GIT.some((p) => p.test(cmd))) return false;
    return BLOCKED_GIT.some((p) => p.test(cmd));
  };

  /** Check if file matches any expected file from plan */
  const isFileExpected = (filePath: string, expectedFiles: string[]): boolean => {
    const relativePath = filePath.replace(directory + "/", "");
    return expectedFiles.some((f) => relativePath.endsWith(f) || relativePath.includes(f));
  };

  /** Check if a relative path is a plan file */
  const isPlanFile = (relativePath: string): boolean => {
    return (
      (relativePath.startsWith(".opencode/plans/") || relativePath.startsWith("plans/")) &&
      relativePath.endsWith(".md")
    );
  };

  /** Scan plans directory and return pending plans (In Progress but not active) */
  const scanPendingPlans = (state: PlanningState): string[] => {
    const plansDir = join(directory, PLANS_DIR);
    if (!existsSync(plansDir)) return [];

    const pending: string[] = [];
    const files = readdirSync(plansDir).filter((f) => f.endsWith(".md"));

    for (const file of files) {
      const relativePath = `${PLANS_DIR}/${file}`;
      if (relativePath === state.activePlan?.file) continue;

      try {
        const content = readFileSync(join(plansDir, file), "utf-8");
        const status = parsePlanStatus(content);
        if (status === "In Progress") {
          pending.push(relativePath);
        }
      } catch {
        // Ignore errors
      }
    }

    return pending;
  };

  // ===========================================================================
  // Hooks
  // ===========================================================================

  return {
    // 1. Session start: show state, load rules
    "session.created": async () => {
      // Load and show rules
      const { valid, invalid } = scanRulesDirectory();

      if (invalid.length > 0) {
        await client.app.log({
          service: "planning-enforcer",
          level: "warn",
          message:
            `Rules missing frontmatter summary:\n` +
            invalid.map((f) => `  - ${f}`).join("\n") +
            `\n\nPlease add frontmatter:\n` +
            `---\nname: rule-name\nsummary: |\n  - Key point 1\n  - Key point 2\n---`,
        });
      }

      if (valid.length > 0) {
        const summaries = valid.map((r) => `**${r.name}:**\n${r.summary}`).join("\n\n");
        await client.app.log({
          service: "planning-enforcer",
          level: "info",
          message: `Rules loaded (${valid.length} files):\n\n${summaries}`,
        });
      }

      // Show planning state
      const state = loadState();

      // Scan for pending plans (In Progress but not active)
      const pendingPlans = scanPendingPlans(state);
      if (pendingPlans.length > 0) {
        state.pendingPlans = pendingPlans;
        saveState(state);
      }

      if (state.activePlan) {
        const pendingCount = state.activePlan.checklistItems.filter((i) => !i.completed).length;
        const completedCount = state.activePlan.checklistItems.filter((i) => i.completed).length;

        let message =
          `Active plan: ${state.activePlan.file}\n` +
          `  - Pending tasks: ${pendingCount}\n` +
          `  - Completed tasks: ${completedCount}\n\n` +
          `Continue working on this plan or mark as Done before starting new work.`;

        if (pendingPlans.length > 0) {
          message +=
            `\n\nOther plans with "In Progress" status:\n` +
            pendingPlans.map((p) => `  - ${p}`).join("\n");
        }

        await client.app.log({
          service: "planning-enforcer",
          level: "info",
          message,
        });
      } else if (pendingPlans.length > 0) {
        // No active plan but there are pending plans
        await client.app.log({
          service: "planning-enforcer",
          level: "warn",
          message:
            `No active plan in state, but found plans with "In Progress" status:\n` +
            pendingPlans.map((p) => `  - ${p}`).join("\n") +
            `\n\nTo activate a plan, edit it (the state will sync automatically).`,
        });
      } else {
        await client.app.log({
          service: "planning-enforcer",
          level: "info",
          message:
            `No active plan.\n\n` +
            `Before modifying files, create a plan:\n` +
            `1. Create file: ${PLANS_DIR}/{feature-name}.md\n` +
            `2. Set **Status:** In Progress\n` +
            `3. Add checklist with tasks (- [ ] ...)`,
        });
      }
    },

    // 2. Before tool execution: validate and block/warn
    "tool.execute.before": async (
      input: { tool: string },
      output: { args?: Record<string, any> },
    ) => {
      const tool = input.tool;
      const args = output.args || {};

      // Block dangerous git operations
      if (tool === "bash" || tool === "mcp_bash") {
        const cmd = args.command || "";

        if (isBlockedGit(cmd)) {
          throw new Error(
            `Git operation blocked by planning-enforcer.\n\n` +
              `Blocked: ${cmd}\n\n` +
              `Per workflow rules, git operations must be done manually by the user.\n` +
              `Allowed: git status, git diff, git log, git branch, git checkout -b`,
          );
        }
      }

      // Handle write/edit operations
      if (isWriteOperation(tool)) {
        const filePath = args.filePath || "";
        const relativePath = filePath.replace(directory + "/", "");

        // Skip exempt files
        if (isExemptFromPlan(relativePath)) {
          // Special handling for plan files
          if (isPlanFile(relativePath)) {
            const planPath = join(directory, relativePath);
            const oldContent = existsSync(planPath) ? readFileSync(planPath, "utf-8") : "";
            const newContent = args.content || "";

            // Validate reactivation
            const reactivation = validatePlanReactivation(relativePath, oldContent, newContent);
            if (!reactivation.allowed) {
              throw new Error(reactivation.reason);
            }

            // Check if plan is being activated
            const newStatus = parsePlanStatus(newContent);
            if (newStatus === "In Progress") {
              // Validate format
              const validation = validatePlanFormat(newContent);
              if (!validation.valid) {
                throw new Error(
                  `Invalid plan format:\n${validation.errors.map((e) => `  - ${e}`).join("\n")}`,
                );
              }

              if (validation.warnings.length > 0) {
                await client.app.log({
                  service: "planning-enforcer",
                  level: "warn",
                  message: `Plan warnings:\n${validation.warnings.map((w) => `  - ${w}`).join("\n")}`,
                });
              }

              // Parse and activate
              const checklistItems = parseChecklist(newContent);
              const state = loadState();
              state.activePlan = {
                file: relativePath,
                startedAt: new Date().toISOString(),
                checklistItems,
              };
              saveState(state);

              // Notify about reactivation if applicable
              if (reactivation.reason) {
                await client.app.log({
                  service: "planning-enforcer",
                  level: "warn",
                  message: reactivation.reason,
                });
              }

              await client.app.log({
                service: "planning-enforcer",
                level: "info",
                message:
                  `Plan activated: ${relativePath}\n\n` +
                  `Tasks to track (use TodoWrite):\n` +
                  checklistItems
                    .map((i) => `  ${i.completed ? "[x]" : "[ ]"} ${i.text}`)
                    .join("\n"),
              });
            }
          }
          return;
        }

        // NON-EXEMPT FILE: Requires active plan
        const state = loadState();

        if (!state.activePlan) {
          throw new Error(
            `Implementation blocked: No active plan.\n\n` +
              `You must create a plan before modifying files.\n\n` +
              `Create a plan first:\n` +
              `1. Create file: ${PLANS_DIR}/{feature-name}.md\n` +
              `2. Add required sections:\n` +
              `   - **Status:** In Progress\n` +
              `   - ## Checklist (with - [ ] tasks)\n` +
              `3. Then continue with implementation\n\n` +
              `Attempted to modify: ${relativePath}`,
          );
        }

        // Warn if file not in plan
        const expectedFiles = getExpectedFiles(state);
        if (expectedFiles.length > 0 && !isFileExpected(filePath, expectedFiles)) {
          await client.app.log({
            service: "planning-enforcer",
            level: "warn",
            message:
              `File not referenced in active plan checklist:\n` +
              `  - ${relativePath}\n\n` +
              `Consider updating the plan to include this file.`,
          });
        }
      }
    },

    // 3. After tool execution: detect plan completion
    "tool.execute.after": async (input: { tool: string; args?: Record<string, any> }) => {
      // Track test execution
      if (input.tool === "bash" || input.tool === "mcp_bash") {
        const cmd = input.args?.command || "";
        if (/bun\s+test/.test(cmd)) {
          testsExecuted = true;
        }
      }

      // Detect plan completion
      if (isWriteOperation(input.tool)) {
        const filePath = input.args?.filePath || "";
        const relativePath = filePath.replace(directory + "/", "");

        if (isPlanFile(relativePath)) {
          const planPath = join(directory, relativePath);
          if (!existsSync(planPath)) return;

          const content = readFileSync(planPath, "utf-8");
          const status = parsePlanStatus(content);
          const state = loadState();

          if (status === "Done" && state.activePlan?.file === relativePath) {
            // Archive completed plan
            state.completedPlans.push({
              file: relativePath,
              completedAt: new Date().toISOString(),
            });
            state.activePlan = null;
            saveState(state);

            await client.app.log({
              service: "planning-enforcer",
              level: "info",
              message: `Plan "${relativePath}" completed! Ready for new work.`,
            });
          }
        }
      }
    },

    // 4. Todo updated: sync with plan checklist
    "todo.updated": async ({
      event,
    }: {
      event: { todos?: Array<{ content: string; status: string }> };
    }) => {
      const todos = event.todos || [];
      const state = loadState();

      if (!state.activePlan) return;

      // Sync each todo status to plan checklist
      for (const todo of todos) {
        const completed = todo.status === "completed" || todo.status === "cancelled";
        syncTodoToPlan(todo.content, completed);
      }

      // Check if all tasks are done
      const updatedState = loadState();
      if (updatedState.activePlan) {
        const allDone = updatedState.activePlan.checklistItems.every((i) => i.completed);
        if (allDone) {
          await client.app.log({
            service: "planning-enforcer",
            level: "info",
            message:
              `All tasks completed!\n\n` +
              `Next steps:\n` +
              `1. Run tests: bun test\n` +
              `2. Update plan status to "Done"\n` +
              `3. Review changes with: git status`,
          });
        }
      }
    },

    // 5. Session idle: check pending items
    "session.idle": async () => {
      const warnings: string[] = [];
      const state = loadState();

      if (state.activePlan) {
        const pendingCount = state.activePlan.checklistItems.filter((i) => !i.completed).length;
        if (pendingCount > 0) {
          warnings.push(
            `Plan "${state.activePlan.file}" has ${pendingCount} pending task(s)\n` +
              `   -> Complete tasks or update plan status`,
          );
        } else {
          warnings.push(
            `Plan "${state.activePlan.file}" has all tasks completed\n` +
              `   -> Update status to "Done"`,
          );
        }
      }

      if (!testsExecuted) {
        warnings.push(`Tests not executed this session\n` + `   -> Run: bun test`);
      }

      if (warnings.length > 0) {
        await client.app.log({
          service: "planning-enforcer",
          level: "warn",
          message: `Post-implementation checklist:\n\n${warnings.join("\n\n")}`,
        });
      }
    },
  };
};
