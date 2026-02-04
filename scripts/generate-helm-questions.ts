#!/usr/bin/env bun

// Generate Helm questions.yml from plugin manifests
//
// This script:
// 1. Reads charts/questions.base.yaml (runtime core questions)
// 2. Scans plugins/*/manifest.yaml for plugin configurations
// 3. Generates questions for each enabled plugin (without enable toggle)
// 4. Writes the combined result to charts/questions.yml
//
// Usage: bun scripts/generate-helm-questions.ts

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { stringify as yamlStringify } from "yaml";

const ROOT_DIR = dirname(import.meta.dir);
const PLUGINS_DIR = join(ROOT_DIR, "plugins");
const CHARTS_DIR = join(ROOT_DIR, "charts");
const BASE_QUESTIONS_FILE = join(CHARTS_DIR, "questions.base.yaml");
const OUTPUT_FILE = join(CHARTS_DIR, "questions.yml");

// Types for manifest config schema
type ConfigType = "string" | "number" | "boolean" | "enum" | "array" | "password" | "object";

interface ConfigFieldBase {
  type: ConfigType;
  label: string;
  description?: string;
  env?: string;
  required?: boolean;
  example?: string;
}

interface ConfigFieldString extends ConfigFieldBase {
  type: "string";
  default?: string;
}

interface ConfigFieldPassword extends ConfigFieldBase {
  type: "password";
  default?: string;
}

interface ConfigFieldNumber extends ConfigFieldBase {
  type: "number";
  default?: number;
  min?: number;
  max?: number;
}

interface ConfigFieldBoolean extends ConfigFieldBase {
  type: "boolean";
  default?: boolean;
}

interface ConfigFieldEnum extends ConfigFieldBase {
  type: "enum";
  default?: string;
  options: string[];
}

interface ConfigFieldArray extends ConfigFieldBase {
  type: "array";
  default?: string[];
}

interface ConfigFieldObject extends ConfigFieldBase {
  type: "object";
  properties: Record<string, ConfigField>;
}

type ConfigField =
  | ConfigFieldString
  | ConfigFieldPassword
  | ConfigFieldNumber
  | ConfigFieldBoolean
  | ConfigFieldEnum
  | ConfigFieldArray
  | ConfigFieldObject;

type ConfigSchema = Record<string, ConfigField>;

interface PluginManifest {
  name: string;
  enabled?: boolean;
  base?: string;
  config?: ConfigSchema;
  [key: string]: unknown;
}

interface RancherQuestion {
  variable: string;
  label: string;
  description?: string;
  type: string;
  default?: unknown;
  required?: boolean;
  group: string;
  min?: number;
  max?: number;
  options?: string[];
}

interface QuestionsFile {
  questions: RancherQuestion[];
}

// Convert config field type to Rancher question type
function toRancherType(field: ConfigField): string {
  switch (field.type) {
    case "string":
      return "string";
    case "password":
      return "password";
    case "number":
      return "int";
    case "boolean":
      return "boolean";
    case "enum":
      return "enum";
    case "array":
      return "multiline";
    case "object":
      return "string"; // Objects are flattened
    default:
      return "string";
  }
}

// Get default value for a config field
function getDefault(field: ConfigField): unknown {
  if ("default" in field) {
    // Arrays become newline-separated strings for multiline input
    if (field.type === "array" && Array.isArray(field.default)) {
      return field.default.join("\n");
    }
    return field.default;
  }
  return undefined;
}

// Extract plugin short name from full name
// Example: "@buntime/plugin-gateway" -> "gateway"
function getPluginShortName(name: string): string {
  const match = name.match(/plugin-(.+)$/);
  return match?.[1] ?? name.replace(/^@buntime\//, "");
}

// Convert plugin short name to group name
// Example: "gateway" -> "Gateway"
function toGroupName(shortName: string): string {
  return shortName
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Flatten nested config fields into questions (without show_if)
function flattenConfig(
  config: ConfigSchema,
  prefix: string,
  group: string,
): RancherQuestion[] {
  const questions: RancherQuestion[] = [];

  for (const [key, field] of Object.entries(config)) {
    const variable = `${prefix}.${key}`;

    if (field.type === "object" && "properties" in field) {
      // Recursively flatten nested objects
      questions.push(...flattenConfig(field.properties, variable, group));
    } else {
      const question: RancherQuestion = {
        variable,
        label: field.label,
        type: toRancherType(field),
        group,
      };

      if (field.description) {
        question.description = field.description;
      }

      const defaultValue = getDefault(field);
      if (defaultValue !== undefined) {
        question.default = defaultValue;
      }

      if (field.required) {
        question.required = true;
      }

      if (field.type === "number") {
        if (field.min !== undefined) question.min = field.min;
        if (field.max !== undefined) question.max = field.max;
      }

      if (field.type === "enum" && "options" in field) {
        question.options = field.options;
      }

      questions.push(question);
    }
  }

  return questions;
}

// Generate questions for a single plugin (without enable toggle)
function generatePluginQuestions(manifest: PluginManifest): RancherQuestion[] {
  const shortName = getPluginShortName(manifest.name);
  const group = toGroupName(shortName);
  const prefix = `plugins.${shortName}`;

  const questions: RancherQuestion[] = [];

  // Only add config fields if present (no enable toggle)
  if (manifest.config) {
    questions.push(...flattenConfig(manifest.config, prefix, group));
  }

  return questions;
}

// Scan plugins directory and load manifests
async function loadPluginManifests(): Promise<PluginManifest[]> {
  const manifests: PluginManifest[] = [];

  if (!existsSync(PLUGINS_DIR)) {
    console.warn(`Plugins directory not found: ${PLUGINS_DIR}`);
    return manifests;
  }

  const entries = readdirSync(PLUGINS_DIR);

  for (const entry of entries) {
    const pluginDir = join(PLUGINS_DIR, entry);
    if (!statSync(pluginDir).isDirectory()) continue;

    // Try manifest.yaml, then manifest.yml
    for (const filename of ["manifest.yaml", "manifest.yml"]) {
      const manifestPath = join(pluginDir, filename);
      if (existsSync(manifestPath)) {
        try {
          const content = await Bun.file(manifestPath).text();
          const manifest = Bun.YAML.parse(content) as PluginManifest;

          if (manifest.name) {
            manifests.push(manifest);
          } else {
            console.warn(`Manifest missing 'name' field: ${manifestPath}`);
          }
        } catch (err) {
          console.error(`Failed to parse ${manifestPath}:`, err);
        }
        break; // Found manifest, don't try other filenames
      }
    }
  }

  // Sort by plugin name for consistent output
  return manifests.sort((a, b) => a.name.localeCompare(b.name));
}

// Main function
async function main() {
  console.log("Generating Helm questions.yml...\n");

  // Load base questions
  if (!existsSync(BASE_QUESTIONS_FILE)) {
    console.error(`Base questions file not found: ${BASE_QUESTIONS_FILE}`);
    process.exit(1);
  }

  const baseContent = await Bun.file(BASE_QUESTIONS_FILE).text();
  const baseQuestions = Bun.YAML.parse(baseContent) as QuestionsFile;

  console.log(`Loaded ${baseQuestions.questions.length} base questions`);

  // Load plugin manifests
  const manifests = await loadPluginManifests();
  console.log(`Found ${manifests.length} plugins with manifests`);

  // Generate plugin questions
  const allQuestions = [...baseQuestions.questions];

  for (const manifest of manifests) {
    // Skip disabled plugins
    if (manifest.enabled === false) {
      console.log(`  - ${manifest.name}: skipped (disabled)`);
      continue;
    }

    const pluginQuestions = generatePluginQuestions(manifest);
    
    if (pluginQuestions.length === 0) {
      console.log(`  - ${manifest.name}: no config fields`);
      continue;
    }

    allQuestions.push(...pluginQuestions);
    console.log(`  - ${manifest.name}: ${pluginQuestions.length} questions`);
  }

  // Write output
  const output: QuestionsFile = { questions: allQuestions };
  const yamlContent = yamlStringify(output, { lineWidth: 0 });

  // Add header comment
  const header = `# AUTO-GENERATED FILE - DO NOT EDIT
# Generated by: bun scripts/generate-helm-questions.ts
# Source: charts/questions.base.yaml + plugins/*/manifest.yaml
#
# To regenerate: bun scripts/generate-helm-questions.ts

`;

  await Bun.write(OUTPUT_FILE, header + yamlContent);

  console.log(`\nWrote ${allQuestions.length} questions to ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
