#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Hono } from "hono";
import { createApp } from "@/app";
import { initConfig } from "@/config";
import { VERSION } from "@/constants";
import { WorkerPool } from "@/libs/pool/pool";
import { PluginRegistry } from "@/plugins/registry";
import { createWorkerRoutes } from "@/routes/worker";

type BenchMode = "direct" | "http";

interface Scenario {
  body?: string;
  concurrency?: number;
  durationMs?: number;
  headers?: Record<string, string>;
  method?: string;
  name: string;
  path: string;
  warmupMs?: number;
}

interface BenchConfig {
  clientTimeoutMs: number;
  concurrency: number;
  durationMs: number;
  fixtureDir: string;
  gateFile?: string;
  keepFixtures: boolean;
  mode: BenchMode;
  outputFile?: string;
  poolSize: number;
  scenarioFilter: Set<string> | null;
  warmupMs: number;
}

interface SerializableBenchConfig extends Omit<BenchConfig, "scenarioFilter"> {
  scenarioFilter: string[] | null;
}

interface ScenarioResult {
  avgMs: number;
  concurrency: number;
  durationMs: number;
  errors: number;
  maxMs: number;
  minMs: number;
  name: string;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  requests: number;
  rps: number;
  statusCounts: Record<string, number>;
}

interface ScenarioThreshold {
  maxAvgMs?: number;
  maxErrors?: number;
  maxP95Ms?: number;
  maxP99Ms?: number;
  minRps?: number;
}

interface GateConfig {
  scenarios?: Record<string, ScenarioThreshold>;
}

interface GateViolation {
  actual: number;
  expected: number;
  metric: keyof ScenarioThreshold;
  scenario: string;
}

const SAMPLE_LIMIT = 1_000_000;

function readIntEnv(name: string, fallback: number): number {
  const raw = Bun.env[name];
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  if (Number.isFinite(value) && value > 0) return value;

  console.warn(`Ignoring invalid ${name}=${raw}; using ${fallback}`);
  return fallback;
}

function readOptionalIntEnv(name: string): number | undefined {
  const raw = Bun.env[name];
  if (!raw) return undefined;

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function readMode(): BenchMode {
  return Bun.env.PERF_MODE === "direct" ? "direct" : "http";
}

function readScenarioFilter(): Set<string> | null {
  const raw = Bun.env.PERF_SCENARIOS;
  if (!raw) return null;

  const names = raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  return names.length > 0 ? new Set(names) : null;
}

function createBenchConfig(): BenchConfig {
  return {
    clientTimeoutMs: readIntEnv("PERF_CLIENT_TIMEOUT_MS", 10_000),
    concurrency: readIntEnv("PERF_CONCURRENCY", 50),
    durationMs: readIntEnv("PERF_DURATION_MS", 10_000),
    fixtureDir: resolve(Bun.env.PERF_FIXTURE_DIR ?? join(import.meta.dir, "..", ".perf-fixtures")),
    gateFile: Bun.env.PERF_GATE_FILE ? resolve(Bun.env.PERF_GATE_FILE) : undefined,
    keepFixtures: Bun.env.PERF_KEEP_FIXTURES === "1",
    mode: readMode(),
    outputFile: Bun.env.PERF_OUTPUT_FILE ? resolve(Bun.env.PERF_OUTPUT_FILE) : undefined,
    poolSize: readIntEnv("PERF_POOL_SIZE", 100),
    scenarioFilter: readScenarioFilter(),
    warmupMs: readIntEnv("PERF_WARMUP_MS", 2_000),
  };
}

function serializeConfig(config: BenchConfig): SerializableBenchConfig {
  return {
    ...config,
    scenarioFilter: config.scenarioFilter ? Array.from(config.scenarioFilter).sort() : null,
  };
}

function readGateConfig(path: string | undefined): GateConfig | undefined {
  if (!path) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as GateConfig;
}

function writeFixtureApp(
  appsDir: string,
  name: string,
  manifest: Record<string, unknown>,
  source: string,
) {
  const appDir = join(appsDir, name);
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, "manifest.yaml"), Bun.YAML.stringify(manifest));
  writeFileSync(
    join(appDir, "package.json"),
    JSON.stringify({ name: `perf-${name}`, version: "1.0.0" }, null, 2),
  );
  writeFileSync(join(appDir, "index.ts"), source);
}

function prepareFixtures(fixtureDir: string) {
  rmSync(fixtureDir, { recursive: true, force: true });

  const appsDir = join(fixtureDir, "apps");
  mkdirSync(appsDir, { recursive: true });

  const baseManifest = {
    entrypoint: "index.ts",
    idleTimeout: "60s",
    maxBodySize: "10mb",
    maxRequests: 1_000_000,
    timeout: "5s",
    ttl: "5m",
  };

  writeFixtureApp(
    appsDir,
    "noop",
    baseManifest,
    `export default {
  fetch: () => new Response("ok", {
    headers: { "content-type": "text/plain; charset=utf-8" },
  }),
};`,
  );

  writeFixtureApp(
    appsDir,
    "echo",
    baseManifest,
    `export default {
  fetch: async (req: Request) => {
    const body = await req.arrayBuffer();
    return Response.json({ bytes: body.byteLength, method: req.method });
  },
};`,
  );

  writeFixtureApp(
    appsDir,
    "slow",
    baseManifest,
    `export default {
  fetch: async (req: Request) => {
    const url = new URL(req.url);
    const requestedMs = Number(url.searchParams.get("ms") ?? "50");
    const ms = Number.isFinite(requestedMs) ? Math.min(Math.max(requestedMs, 0), 1000) : 50;
    await Bun.sleep(ms);
    return new Response("ok", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};`,
  );

  writeFixtureApp(
    appsDir,
    "ephemeral",
    { ...baseManifest, ttl: 0 },
    `export default {
  fetch: () => new Response("ok", {
    headers: { "content-type": "text/plain; charset=utf-8" },
  }),
};`,
  );

  return appsDir;
}

function createScenarios(config: BenchConfig): Scenario[] {
  const defaultConcurrency = config.concurrency;
  const slowConcurrency = Math.min(defaultConcurrency, 100);
  const ephemeralConcurrency = Math.min(defaultConcurrency, 10);

  const scenarios: Scenario[] = [
    {
      name: "warm-noop",
      path: "/noop/ping",
    },
    {
      body: "x".repeat(1024),
      headers: { "content-type": "text/plain" },
      method: "POST",
      name: "echo-1kb",
      path: "/echo/body",
    },
    {
      concurrency: slowConcurrency,
      name: "slow-50ms",
      path: "/slow/wait?ms=50",
    },
    {
      concurrency: ephemeralConcurrency,
      name: "ephemeral-noop",
      path: "/ephemeral/ping",
    },
  ];

  if (!config.scenarioFilter) return scenarios;
  return scenarios.filter((scenario) => config.scenarioFilter?.has(scenario.name));
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * p) - 1);
  return sortedValues[index] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function summarize(
  scenario: Scenario,
  durationMs: number,
  concurrency: number,
  latencies: number[],
  errors: number,
  statusCounts: Record<string, number>,
): ScenarioResult {
  latencies.sort((a, b) => a - b);
  const requests = Object.values(statusCounts).reduce((total, count) => total + count, 0);
  const sum = latencies.reduce((total, value) => total + value, 0);

  return {
    avgMs: round(latencies.length > 0 ? sum / latencies.length : 0),
    concurrency,
    durationMs,
    errors,
    maxMs: round(latencies.at(-1) ?? 0),
    minMs: round(latencies[0] ?? 0),
    name: scenario.name,
    p50Ms: round(percentile(latencies, 0.5)),
    p95Ms: round(percentile(latencies, 0.95)),
    p99Ms: round(percentile(latencies, 0.99)),
    requests,
    rps: round(requests / (durationMs / 1000)),
    statusCounts,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: Timer | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runScenario(
  scenario: Scenario,
  config: BenchConfig,
  fetchOnce: (scenario: Scenario) => Promise<{ durationMs: number; status: number }>,
): Promise<ScenarioResult> {
  const durationMs = scenario.durationMs ?? config.durationMs;
  const warmupMs = scenario.warmupMs ?? config.warmupMs;
  const concurrency = scenario.concurrency ?? config.concurrency;

  async function runPhase(record: boolean) {
    const deadline = performance.now() + (record ? durationMs : warmupMs);
    const latencies: number[] = [];
    const statusCounts: Record<string, number> = {};
    let errors = 0;

    async function loop() {
      while (performance.now() < deadline) {
        try {
          const result = await withTimeout(
            fetchOnce(scenario),
            config.clientTimeoutMs,
            `${scenario.name} request`,
          );
          const statusKey = String(result.status);
          statusCounts[statusKey] = (statusCounts[statusKey] ?? 0) + 1;
          if (result.status >= 400) errors++;
          if (record && latencies.length < SAMPLE_LIMIT) {
            latencies.push(result.durationMs);
          }
        } catch {
          errors++;
          statusCounts.error = (statusCounts.error ?? 0) + 1;
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => loop()));

    return { errors, latencies, statusCounts };
  }

  if (warmupMs > 0) {
    await runPhase(false);
  }

  const measured = await runPhase(true);
  return summarize(
    scenario,
    durationMs,
    concurrency,
    measured.latencies,
    measured.errors,
    measured.statusCounts,
  );
}

function printResults(results: ScenarioResult[]) {
  const rows = results.map((result) => ({
    scenario: result.name,
    conc: result.concurrency,
    reqs: result.requests,
    rps: result.rps,
    errors: result.errors,
    p50: result.p50Ms,
    p95: result.p95Ms,
    p99: result.p99Ms,
    avg: result.avgMs,
    max: result.maxMs,
  }));

  console.table(rows);
}

function evaluateGates(
  results: ScenarioResult[],
  gateConfig: GateConfig | undefined,
): GateViolation[] {
  const violations: GateViolation[] = [];

  for (const result of results) {
    const thresholds = gateConfig?.scenarios?.[result.name] ?? {};
    const maxErrors = thresholds.maxErrors ?? 0;

    if (result.errors > maxErrors) {
      violations.push({
        actual: result.errors,
        expected: maxErrors,
        metric: "maxErrors",
        scenario: result.name,
      });
    }

    if (thresholds.minRps !== undefined && result.rps < thresholds.minRps) {
      violations.push({
        actual: result.rps,
        expected: thresholds.minRps,
        metric: "minRps",
        scenario: result.name,
      });
    }

    if (thresholds.maxP95Ms !== undefined && result.p95Ms > thresholds.maxP95Ms) {
      violations.push({
        actual: result.p95Ms,
        expected: thresholds.maxP95Ms,
        metric: "maxP95Ms",
        scenario: result.name,
      });
    }

    if (thresholds.maxP99Ms !== undefined && result.p99Ms > thresholds.maxP99Ms) {
      violations.push({
        actual: result.p99Ms,
        expected: thresholds.maxP99Ms,
        metric: "maxP99Ms",
        scenario: result.name,
      });
    }

    if (thresholds.maxAvgMs !== undefined && result.avgMs > thresholds.maxAvgMs) {
      violations.push({
        actual: result.avgMs,
        expected: thresholds.maxAvgMs,
        metric: "maxAvgMs",
        scenario: result.name,
      });
    }
  }

  return violations;
}

function printGateViolations(violations: GateViolation[]) {
  if (violations.length === 0) return;

  console.error("Performance gate failed:");
  for (const violation of violations) {
    console.error(
      `- ${violation.scenario} ${violation.metric}: actual=${violation.actual} expected=${violation.expected}`,
    );
  }
}

function startHttpServer(
  fetchHandler: (request: Request) => Response | Promise<Response>,
): ReturnType<typeof Bun.serve> {
  const explicitPort = readOptionalIntEnv("PERF_PORT");
  const startPort = explicitPort ?? 32_000 + Math.floor(Math.random() * 10_000);
  const attempts = explicitPort ? 1 : 100;

  for (let offset = 0; offset < attempts; offset++) {
    const port = startPort + offset;
    try {
      return Bun.serve({ fetch: (request) => fetchHandler(request), port });
    } catch (error) {
      if (explicitPort || offset === attempts - 1) {
        throw error;
      }
    }
  }

  throw new Error("Failed to start HTTP benchmark server");
}

async function main() {
  const config = createBenchConfig();
  const gateConfig = readGateConfig(config.gateFile);
  const appsDir = prepareFixtures(config.fixtureDir);

  initConfig({
    baseDir: config.fixtureDir,
    workerDirs: [appsDir],
  });

  const registry = new PluginRegistry();
  const pool = new WorkerPool({ maxSize: config.poolSize });
  const getWorkerDir = (name: string) => {
    const dir = join(appsDir, name);
    return existsSync(dir) ? dir : undefined;
  };

  const coreRoutes = new Hono().get("/health", (c) => c.json({ ok: true }));
  const workers = createWorkerRoutes({
    config: { version: VERSION },
    getWorkerDir: (name) => getWorkerDir(name) ?? "",
    pool,
    registry,
  });
  const app = createApp({ coreRoutes, getWorkerDir, pool, registry, workers });
  const scenarios = createScenarios(config);
  if (scenarios.length === 0) {
    console.error("No scenarios selected. Check PERF_SCENARIOS.");
    pool.shutdown();
    rmSync(config.fixtureDir, { recursive: true, force: true });
    process.exitCode = 1;
    return;
  }

  console.log(
    [
      `runtime perf mode=${config.mode}`,
      `duration=${config.durationMs}ms`,
      `warmup=${config.warmupMs}ms`,
      `concurrency=${config.concurrency}`,
      `poolSize=${config.poolSize}`,
      `fixtures=${config.fixtureDir}`,
    ].join(" "),
  );

  let server: ReturnType<typeof Bun.serve> | undefined;

  try {
    const baseUrl =
      config.mode === "http"
        ? (() => {
            server = startHttpServer(app.fetch);
            return `http://127.0.0.1:${server.port}`;
          })()
        : "http://buntime.local";

    const fetchOnce = async (scenario: Scenario) => {
      const init: RequestInit = {
        body: scenario.body,
        headers: scenario.headers,
        method: scenario.method ?? "GET",
      };
      const request = new Request(`${baseUrl}${scenario.path}`, init);
      const start = performance.now();
      const response = config.mode === "http" ? await fetch(request) : await app.fetch(request);
      await response.arrayBuffer();
      return {
        durationMs: performance.now() - start,
        status: response.status,
      };
    };

    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
      results.push(await runScenario(scenario, config, fetchOnce));
    }

    printResults(results);

    const poolMetrics = pool.getMetrics();
    console.log("pool metrics", JSON.stringify(poolMetrics, null, 2));
    const gateViolations = evaluateGates(results, gateConfig);
    const report = {
      config: serializeConfig(config),
      gateViolations,
      poolMetrics,
      results,
    };

    if (config.outputFile) {
      writeFileSync(config.outputFile, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`wrote performance report ${config.outputFile}`);
    }

    if (Bun.env.PERF_JSON === "1") {
      console.log(JSON.stringify(report, null, 2));
    }

    if (gateViolations.length > 0) {
      printGateViolations(gateViolations);
      process.exitCode = 1;
    }
  } finally {
    pool.shutdown();
    server?.stop(true);

    if (!config.keepFixtures) {
      rmSync(config.fixtureDir, { recursive: true, force: true });
    }
  }
}

await main();
