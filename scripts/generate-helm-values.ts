#!/usr/bin/env bun

// Generate Helm values.yaml from plugin manifests
//
// This script:
// 1. Reads charts/buntime/values.base.yaml (runtime core values)
// 2. Scans plugins/*/manifest.yaml for plugin configurations
// 3. Generates values for each enabled plugin based on their config schema
// 4. Writes the combined result to charts/buntime/values.yaml
//
// Usage: bun scripts/generate-helm-values.ts

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { stringify as yamlStringify } from "yaml";

const ROOT_DIR = dirname(import.meta.dir);
const PLUGINS_DIR = join(ROOT_DIR, "plugins");
const CHARTS_DIR = join(ROOT_DIR, "charts", "buntime");
const BASE_VALUES_FILE = join(CHARTS_DIR, "values.base.yaml");
const OUTPUT_FILE = join(CHARTS_DIR, "values.yaml");

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

// Extract plugin short name from full name
// Example: "@buntime/plugin-gateway" -> "gateway"
function getPluginShortName(name: string): string {
  const match = name.match(/plugin-(.+)$/);
  return match?.[1] ?? name.replace(/^@buntime\//, "");
}

// Get default value for a config field
function getDefaultValue(field: ConfigField): unknown {
  switch (field.type) {
    case "string":
    case "password":
    case "enum":
      return field.default ?? "";
    case "number":
      return field.default ?? 0;
    case "boolean":
      return field.default ?? false;
    case "array":
      return field.default ?? [];
    case "object":
      if ("properties" in field) {
        return extractDefaults(field.properties);
      }
      return {};
    default:
      return "";
  }
}

// Extract default values from config schema
function extractDefaults(config: ConfigSchema): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(config)) {
    defaults[key] = getDefaultValue(field);
  }

  return defaults;
}

// Generate values for a single plugin (without enabled field)
function generatePluginValues(manifest: PluginManifest): Record<string, unknown> | null {
  // Only generate values if plugin has config schema
  if (!manifest.config) {
    return null;
  }

  return extractDefaults(manifest.config);
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
        break;
      }
    }
  }

  // Sort by plugin name for consistent output
  return manifests.sort((a, b) => a.name.localeCompare(b.name));
}

// Main function
async function main() {
  console.log("Generating Helm values.yaml...\n");

  // Load base values
  if (!existsSync(BASE_VALUES_FILE)) {
    console.error(`Base values file not found: ${BASE_VALUES_FILE}`);
    process.exit(1);
  }

  const baseContent = await Bun.file(BASE_VALUES_FILE).text();
  const baseValues = Bun.YAML.parse(baseContent) as Record<string, unknown>;

  console.log("Loaded base values");

  // Load plugin manifests
  const manifests = await loadPluginManifests();
  console.log(`Found ${manifests.length} plugins with manifests`);

  // Generate plugin values
  const plugins: Record<string, unknown> = {};

  for (const manifest of manifests) {
    // Skip disabled plugins
    if (manifest.enabled === false) {
      console.log(`  - ${manifest.name}: skipped (disabled)`);
      continue;
    }

    const shortName = getPluginShortName(manifest.name);
    const pluginValues = generatePluginValues(manifest);
    
    if (!pluginValues) {
      console.log(`  - ${manifest.name}: no config fields`);
      continue;
    }

    plugins[shortName] = pluginValues;

    const fieldCount = Object.keys(pluginValues).length;
    console.log(`  - ${manifest.name}: ${fieldCount} config fields`);
  }

  // Combine base values with plugin values (only if plugins have values)
  const output: Record<string, unknown> = { ...baseValues };
  if (Object.keys(plugins).length > 0) {
    output.plugins = plugins;
  }

  // Write output
  const yamlContent = yamlStringify(output, {
    lineWidth: 0,
    nullStr: "",
  });

  // Add header comment
  const header = `# AUTO-GENERATED FILE - DO NOT EDIT
# Generated by: bun scripts/generate-helm-values.ts
# Source: charts/buntime/values.base.yaml + plugins/*/manifest.yaml
#
# To regenerate: bun scripts/generate-helm.ts

`;

  await Bun.write(OUTPUT_FILE, header + yamlContent);

  console.log(`\nWrote values to ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
