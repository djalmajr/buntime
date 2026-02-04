#!/usr/bin/env bun

// Generate Helm configmap.yaml from plugin manifests
//
// This script:
// 1. Reads charts/buntime/configmap.base.yaml (runtime core env vars)
// 2. Scans plugins/*/manifest.yaml for plugin configurations
// 3. Generates Helm template conditionals for each plugin's env vars
// 4. Writes the combined result to charts/buntime/templates/configmap.yaml
//
// Usage: bun scripts/generate-helm-configmap.ts

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT_DIR = dirname(import.meta.dir);
const PLUGINS_DIR = join(ROOT_DIR, "plugins");
const CHARTS_DIR = join(ROOT_DIR, "charts", "buntime");
const BASE_CONFIGMAP_FILE = join(CHARTS_DIR, "configmap.base.yaml");
const OUTPUT_FILE = join(CHARTS_DIR, "templates", "configmap.yaml");

// Types for manifest config schema
type ConfigType = "string" | "number" | "boolean" | "enum" | "array" | "password" | "object";

interface ConfigFieldBase {
  type: ConfigType;
  label: string;
  description?: string;
  env?: string;
  required?: boolean;
  default?: string | number | boolean;
}

interface ConfigFieldObject extends ConfigFieldBase {
  type: "object";
  properties: Record<string, ConfigField>;
}

type ConfigField = ConfigFieldBase | ConfigFieldObject;
type ConfigSchema = Record<string, ConfigField>;

interface PluginManifest {
  name: string;
  enabled?: boolean;
  base?: string;
  config?: ConfigSchema;
  [key: string]: unknown;
}

interface EnvMapping {
  envVar: string;
  valuePath: string;
  type: ConfigType;
  defaultValue?: string | number | boolean;
}

// Extract plugin short name from full name
// Example: "@buntime/plugin-gateway" -> "gateway"
function getPluginShortName(name: string): string {
  const match = name.match(/plugin-(.+)$/);
  return match?.[1] ?? name.replace(/^@buntime\//, "");
}

// Extract env var mappings from config schema
function extractEnvVars(config: ConfigSchema, shortName: string, parentPath: string): EnvMapping[] {
  const mappings: EnvMapping[] = [];

  for (const [key, field] of Object.entries(config)) {
    const currentPath = parentPath ? `${parentPath}.${key}` : key;

    if (field.type === "object" && "properties" in field) {
      // Recursively extract from nested objects
      mappings.push(...extractEnvVars(field.properties, shortName, currentPath));
    } else if (field.env) {
      // Only include fields with explicit env var mapping
      mappings.push({
        envVar: field.env,
        valuePath: currentPath,
        type: field.type,
        defaultValue: field.default,
      });
    }
  }

  return mappings;
}

// Generate Helm template section for a plugin (without enabled conditional)
function generatePluginSection(shortName: string, mappings: EnvMapping[]): string {
  if (mappings.length === 0) return "";

  const lines: string[] = [];
  const pluginPath = `.Values.plugins.${shortName}`;

  lines.push(`  # ${shortName.charAt(0).toUpperCase() + shortName.slice(1)} plugin`);

  for (const mapping of mappings) {
    // valuePath is like "libsqlUrl" or "cors.origin"
    const helmPath = `${pluginPath}.${mapping.valuePath}`;
    const defaultStr = mapping.defaultValue !== undefined ? String(mapping.defaultValue) : "";

    // Handle different types
    if (mapping.type === "boolean") {
      // Boolean: only set env var if true (conditional OK)
      lines.push(`  {{- if ${helmPath} }}`);
      lines.push(`  ${mapping.envVar}: "true"`);
      lines.push(`  {{- end }}`);
    } else if (mapping.type === "array") {
      // Array: optional (e.g., replicas), conditional OK
      lines.push(`  {{- if ${helmPath} }}`);
      lines.push(`  {{- if kindIs "string" ${helmPath} }}`);
      lines.push(`  {{- /* Handle multiline string from Rancher UI */}}`);
      lines.push(`  {{- $lines := splitList "\\n" ${helmPath} }}`);
      lines.push(`  {{- $index := 0 }}`);
      lines.push(`  {{- range $lines }}`);
      lines.push(`  {{- $val := trim . }}`);
      lines.push(`  {{- if $val }}`);
      lines.push(`  {{- $index = add $index 1 }}`);
      lines.push(`  ${mapping.envVar}_{{ $index }}: {{ $val | quote }}`);
      lines.push(`  {{- end }}`);
      lines.push(`  {{- end }}`);
      lines.push(`  {{- else }}`);
      lines.push(`  {{- /* Handle array from values.yaml */}}`);
      lines.push(`  {{- range $index, $val := ${helmPath} }}`);
      lines.push(`  ${mapping.envVar}_{{ add $index 1 }}: {{ $val | quote }}`);
      lines.push(`  {{- end }}`);
      lines.push(`  {{- end }}`);
      lines.push(`  {{- end }}`);
    } else if (mapping.type === "password") {
      // Password: optional (e.g., auth tokens), conditional OK
      lines.push(`  {{- if ${helmPath} }}`);
      lines.push(`  ${mapping.envVar}: {{ ${helmPath} | quote }}`);
      lines.push(`  {{- end }}`);
    } else {
      // string, number, enum - ALWAYS output with default
      if (defaultStr) {
        lines.push(`  ${mapping.envVar}: {{ ${helmPath} | default "${defaultStr}" | quote }}`);
      } else {
        // No default: still output with empty string default
        lines.push(`  ${mapping.envVar}: {{ ${helmPath} | default "" | quote }}`);
      }
    }
  }

  lines.push("");

  return lines.join("\n");
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

  return manifests.sort((a, b) => a.name.localeCompare(b.name));
}

// Main function
async function main() {
  console.log("Generating Helm configmap.yaml...\n");

  // Load base configmap
  if (!existsSync(BASE_CONFIGMAP_FILE)) {
    console.error(`Base configmap file not found: ${BASE_CONFIGMAP_FILE}`);
    process.exit(1);
  }

  const baseContent = await Bun.file(BASE_CONFIGMAP_FILE).text();
  console.log("Loaded base configmap");

  // Load plugin manifests
  const manifests = await loadPluginManifests();
  console.log(`Found ${manifests.length} plugins with manifests`);

  // Generate plugin sections
  const pluginSections: string[] = [];

  for (const manifest of manifests) {
    // Skip disabled plugins
    if (manifest.enabled === false) {
      console.log(`  - ${manifest.name}: skipped (disabled)`);
      continue;
    }

    const shortName = getPluginShortName(manifest.name);

    if (!manifest.config) {
      console.log(`  - ${manifest.name}: no config schema`);
      continue;
    }

    const mappings = extractEnvVars(manifest.config, shortName, "");
    const envVarCount = mappings.length;

    if (envVarCount === 0) {
      console.log(`  - ${manifest.name}: no env vars`);
      continue;
    }

    const section = generatePluginSection(shortName, mappings);
    pluginSections.push(section);
    console.log(`  - ${manifest.name}: ${envVarCount} env vars`);
  }

  // Combine base with plugin sections
  const header = `# AUTO-GENERATED FILE - DO NOT EDIT
# Generated by: bun scripts/generate-helm-configmap.ts
# Source: charts/buntime/configmap.base.yaml + plugins/*/manifest.yaml
#
# To regenerate: bun scripts/generate-helm.ts

`;

  // Remove the "# Plugin env vars" comment line from base if present
  const baseClean = baseContent
    .split("\n")
    .filter((line) => !line.includes("# Plugin env vars") && !line.includes("Do not edit below"))
    .join("\n")
    .trim();

  const output = header + baseClean + "\n\n" + pluginSections.join("\n");

  await Bun.write(OUTPUT_FILE, output);

  console.log(`\nWrote configmap to ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
