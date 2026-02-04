#!/usr/bin/env bun
/**
 * Task Plan CLI
 * Command-line interface for managing plans
 * 
 * Usage: bun run cli.ts <command> [options]
 * 
 * Commands:
 *   show              - Show the active plan
 *   list              - List all plans
 *   create            - Create a new plan
 *   activate <id>     - Activate a plan
 *   complete          - Mark active plan as done
 *   delete <id>       - Delete a plan
 */

import { loadConfig } from "./config";
import {
  getActivePlan,
  listPlans,
  createPlan,
  activatePlan,
  completePlan,
  deletePlan,
  getTasks,
  getTaskCounts,
} from "./core/plan";

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const config = loadConfig(projectDir);

function formatProgress(completed: number, total: number): string {
  if (total === 0) return "No tasks";
  const pct = Math.round((completed / total) * 100);
  return `${completed}/${total} (${pct}%)`;
}

function formatDate(date: string | undefined): string {
  if (!date) return "-";
  return new Date(date).toLocaleString();
}

function showPlan(): void {
  const plan = getActivePlan(projectDir, config);
  
  if (!plan) {
    console.log("No active plan.");
    console.log("");
    console.log("Create one with: /plan-new");
    return;
  }

  const tasks = getTasks(projectDir, config, plan.id);
  const counts = getTaskCounts(projectDir, config, plan.id);

  console.log(`# ${plan.title}`);
  console.log("");
  console.log(`**Status:** ${plan.status}`);
  console.log(`**Progress:** ${formatProgress(counts.completed, counts.total)}`);
  console.log("");
  console.log(`## Summary (TL;DR)`);
  console.log(plan.summary);

  if (tasks.length > 0) {
    console.log("");
    console.log(`## Tasks`);
    tasks.forEach((task) => {
      const check = task.done ? "x" : " ";
      console.log(`- [${check}] [id:${task.id}] ${task.text}`);
    });
  }

  console.log("");
  console.log(`## Description`);
  console.log(plan.description);

  if (plan.modifiedFiles.length > 0) {
    console.log("");
    console.log(`## Modified Files`);
    plan.modifiedFiles.forEach((f) => console.log(`- ${f}`));
  }

  console.log("");
  console.log(`---`);
  console.log(`ID: ${plan.id}`);
  console.log(`Created: ${formatDate(plan.createdAt)}`);
  console.log(`Updated: ${formatDate(plan.updatedAt)}`);
}

function listAllPlans(): void {
  const plans = listPlans(projectDir, config);
  
  if (plans.length === 0) {
    console.log("No plans found.");
    console.log("");
    console.log("Create one with: /plan-new");
    return;
  }

  console.log("| ID | Summary | Status | Progress | Updated |");
  console.log("|:---|:--------|:-------|:---------|:--------|");
  
  plans.forEach((plan) => {
    const counts = getTaskCounts(projectDir, config, plan.id);
    const active = plan.isActive ? " *" : "";
    const progress = formatProgress(counts.completed, counts.total);
    const updated = plan.updatedAt.split("T")[0];
    // Truncate summary for table display
    const summaryShort = plan.summary.length > 50 ? plan.summary.slice(0, 47) + "..." : plan.summary;
    console.log(`| ${plan.id}${active} | ${summaryShort} | ${plan.status} | ${progress} | ${updated} |`);
  });

  console.log("");
  console.log("* = active plan");
}

function create(): void {
  const args = process.argv.slice(3);
  
  let id = "";
  let title = "";
  let summary = "";
  let description = "";
  const tasks: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--id" && args[i + 1]) {
      id = args[++i];
    } else if (arg === "--title" && args[i + 1]) {
      title = args[++i];
    } else if (arg === "--summary" && args[i + 1]) {
      summary = args[++i];
    } else if (arg === "--description" && args[i + 1]) {
      description = args[++i];
    } else if (arg === "--task" && args[i + 1]) {
      tasks.push(args[++i]);
    }
  }

  if (!id || !title || !summary || !description) {
    console.error("Usage: create --id <id> --title <title> --summary <text> --description <text> [--task <task>...]");
    console.error("");
    console.error("Required:");
    console.error("  --id           Plan identifier (kebab-case)");
    console.error("  --title        Short title for the plan");
    console.error("  --summary      TL;DR - concise summary (1-2 sentences)");
    console.error("  --description  Full description with sections (Markdown)");
    console.error("");
    console.error("Optional:");
    console.error("  --task         Add a task (can be repeated)");
    process.exit(1);
  }

  const plan = createPlan(projectDir, config, id, title, summary, description, tasks.length > 0 ? tasks : undefined);
  console.log(`Created plan: ${plan.id}`);
  console.log(`Title: ${plan.title}`);
  console.log(`Summary: ${plan.summary}`);
  if (tasks.length > 0) {
    console.log(`Tasks: ${tasks.length}`);
  }
}

function activate(): void {
  const id = process.argv[3];
  
  if (!id) {
    console.error("Usage: activate <plan-id>");
    process.exit(1);
  }

  const plan = activatePlan(projectDir, config, id);
  
  if (!plan) {
    console.error(`Plan not found: ${id}`);
    process.exit(1);
  }

  console.log(`Activated plan: ${plan.id}`);
  console.log(`Status: ${plan.status}`);
  console.log(`Summary: ${plan.summary}`);
}

function complete(): void {
  const plan = getActivePlan(projectDir, config);
  
  if (!plan) {
    console.error("No active plan to complete.");
    process.exit(1);
  }

  const counts = getTaskCounts(projectDir, config, plan.id);
  
  if (counts.pending > 0) {
    console.log(`Warning: ${counts.pending} tasks still pending.`);
  }

  const completed = completePlan(projectDir, config, plan.id);
  
  if (completed) {
    console.log(`Completed plan: ${completed.id}`);
    console.log(`Title: ${completed.title}`);
    console.log(`Tasks: ${counts.completed}/${counts.total} completed`);
  }
}

function remove(): void {
  const id = process.argv[3];
  
  if (!id) {
    console.error("Usage: delete <plan-id>");
    process.exit(1);
  }

  const deleted = deletePlan(projectDir, config, id);
  
  if (deleted) {
    console.log(`Deleted plan: ${id}`);
  } else {
    console.error(`Plan not found: ${id}`);
    process.exit(1);
  }
}

function showHelp(): void {
  console.log("Planning CLI");
  console.log("");
  console.log("Usage: bun run cli.ts <command> [options]");
  console.log("");
  console.log("Commands:");
  console.log("  show              Show the active plan");
  console.log("  list              List all plans");
  console.log("  create            Create a new plan");
  console.log("  activate <id>     Activate a plan");
  console.log("  complete          Mark active plan as done");
  console.log("  delete <id>       Delete a plan");
  console.log("");
  console.log("Examples:");
  console.log("");
  console.log("  # Create a plan");
  console.log('  bun run cli.ts create \\');
  console.log('    --id "add-auth" \\');
  console.log('    --title "Add Authentication" \\');
  console.log('    --summary "Implement JWT auth for API endpoints" \\');
  console.log('    --description "## Context\\nNeed auth for security...\\n## Scope\\n..." \\');
  console.log('    --task "Create auth middleware" \\');
  console.log('    --task "Add login endpoint" \\');
  console.log('    --task "Add tests"');
  console.log("");
  console.log("  # Activate and start working");
  console.log("  bun run cli.ts activate add-auth");
  console.log("");
  console.log("  # View current plan");
  console.log("  bun run cli.ts show");
  console.log("");
  console.log("  # Mark as done");
  console.log("  bun run cli.ts complete");
}

// Main
const command = process.argv[2];

switch (command) {
  case "show":
    showPlan();
    break;
  case "list":
    listAllPlans();
    break;
  case "create":
    create();
    break;
  case "activate":
    activate();
    break;
  case "complete":
    complete();
    break;
  case "delete":
    remove();
    break;
  case "help":
  case "--help":
  case "-h":
    showHelp();
    break;
  default:
    showHelp();
    process.exit(command ? 1 : 0);
}
