import { expect, test as base } from "@playwright/test";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const cpanelDir = join(repoRoot, "apps/cpanel");
const runtimeDir = join(repoRoot, "apps/runtime");

interface RuntimePaths {
  builtInApps: string;
  builtInPlugins: string;
  root: string;
  state: string;
  uploadedApps: string;
  uploadedPlugins: string;
}

export interface RuntimeInstance {
  apiPath: string;
  baseURL: string;
  masterKey: string;
  paths: RuntimePaths;
  requestLogFile: string;
  stop: () => Promise<void>;
}

interface StartRuntimeOptions {
  apiPrefix?: string;
}

interface LoggedRequest {
  app: string | null;
  method: string;
  path: string;
}

async function getFreePort(): Promise<number> {
  const server = createServer();

  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        rejectPromise(new Error("Unable to allocate a TCP port"));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          rejectPromise(error);
          return;
        }

        resolvePromise(port);
      });
    });
  });
}

async function waitForRuntime(baseURL: string): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 20_000) {
    try {
      const response = await fetch(`${baseURL}/.well-known/buntime`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }

  throw new Error(`Runtime did not become ready: ${String(lastError)}`);
}

async function assertCpanelBuildExists(): Promise<void> {
  const indexPath = join(cpanelDir, "dist/index.html");

  try {
    await stat(indexPath);
  } catch {
    throw new Error(
      "CPanel dist/index.html is missing. Run `bun run --filter '@buntime/cpanel' build` before E2E tests.",
    );
  }
}

async function prepareCpanelApp(targetDir: string): Promise<void> {
  await assertCpanelBuildExists();
  await mkdir(targetDir, { recursive: true });
  await cp(join(cpanelDir, "dist"), join(targetDir, "dist"), { recursive: true });
  await cp(join(cpanelDir, "manifest.yaml"), join(targetDir, "manifest.yaml"));
  await writeFile(
    join(targetDir, "package.json"),
    `${JSON.stringify({ name: "cpanel", version: "latest" }, null, 2)}\n`,
  );
}

async function prepareBuiltInPlugin(targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  await writeFile(
    join(targetDir, "manifest.yaml"),
    [
      'name: "@buntime/plugin-builtin-audit"',
      'version: "0.0.0"',
      'base: "/builtin-audit"',
      'pluginEntry: "plugin.ts"',
      "",
    ].join("\n"),
  );
  await writeFile(
    join(targetDir, "plugin.ts"),
    [
      "export default function builtinAuditPlugin() {",
      "  return {};",
      "}",
      "",
    ].join("\n"),
  );
}

async function prepareRuntimeLayout(): Promise<RuntimePaths> {
  const root = await mkdtemp(join(tmpdir(), "buntime-e2e-"));
  const paths: RuntimePaths = {
    builtInApps: join(root, ".apps"),
    builtInPlugins: join(root, ".plugins"),
    root,
    state: join(root, "state"),
    uploadedApps: join(root, "apps"),
    uploadedPlugins: join(root, "plugins"),
  };

  await Promise.all([
    mkdir(paths.builtInApps, { recursive: true }),
    mkdir(paths.builtInPlugins, { recursive: true }),
    mkdir(paths.state, { recursive: true }),
    mkdir(paths.uploadedApps, { recursive: true }),
    mkdir(paths.uploadedPlugins, { recursive: true }),
  ]);

  await prepareCpanelApp(join(paths.builtInApps, "cpanel"));
  await prepareBuiltInPlugin(join(paths.builtInPlugins, "plugin-builtin-audit"));

  return paths;
}

export async function startRuntime(options: StartRuntimeOptions = {}): Promise<RuntimeInstance> {
  const paths = await prepareRuntimeLayout();
  const port = await getFreePort();
  const apiPrefix = options.apiPrefix ?? "";
  const apiPath = `${apiPrefix}/api`.replace(/\/+/g, "/");
  const baseURL = `http://127.0.0.1:${port}`;
  const masterKey = `master-${crypto.randomUUID()}`;
  const requestLogFile = join(paths.root, "request-log.jsonl");
  const output: string[] = [];

  const child = spawn("bun", ["src/index.ts"], {
    cwd: runtimeDir,
    env: {
      ...process.env,
      E2E_REQUEST_LOG_FILE: requestLogFile,
      NODE_ENV: "test",
      PORT: String(port),
      RUNTIME_API_PREFIX: apiPrefix,
      RUNTIME_LOG_LEVEL: "error",
      RUNTIME_MASTER_KEY: masterKey,
      RUNTIME_PLUGIN_DIRS: `${paths.builtInPlugins}:${paths.uploadedPlugins}`,
      RUNTIME_PORT: String(port),
      RUNTIME_STATE_DIR: paths.state,
      RUNTIME_WORKER_DIRS: `${paths.builtInApps}:${paths.uploadedApps}`,
      RUNTIME_WORKER_RESOLVER_CACHE_TTL_MS: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));

  try {
    await waitForRuntime(baseURL);
  } catch (error) {
    child.kill("SIGKILL");
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output.join("")}`);
  }

  async function stop(): Promise<void> {
    child.kill("SIGINT");
    const exited = new Promise<number | null>((resolvePromise) => {
      child.once("exit", (code) => resolvePromise(code));
    });
    const shutdown = Promise.race([
      exited,
      new Promise<number>((resolvePromise) => setTimeout(() => resolvePromise(-1), 5_000)),
    ]);
    const code = await shutdown;
    if (code === -1) child.kill("SIGKILL");

    if (!process.env.BUNTIME_E2E_KEEP_TEMP) {
      await rm(paths.root, { force: true, recursive: true });
    }
  }

  return {
    apiPath,
    baseURL,
    masterKey,
    paths,
    requestLogFile,
    stop,
  };
}

export function archiveName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

async function zipDirectory(sourceDir: string, archivePath: string): Promise<string> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    execFile("zip", ["-r", "-q", archivePath, "."], { cwd: sourceDir }, (error, _stdout, stderr) => {
      if (error) {
        rejectPromise(new Error(stderr || error.message));
        return;
      }

      resolvePromise();
    });
  });

  return archivePath;
}

export async function createLandingAppArchive(
  runtime: RuntimeInstance,
  appName = archiveName("admin-landing-e2e"),
): Promise<{ appName: string; archivePath: string }> {
  const sourceDir = join(runtime.paths.root, "packages", appName);
  await mkdir(sourceDir, { recursive: true });
  await writeFile(
    join(sourceDir, "manifest.yaml"),
    [
      `name: "${appName}"`,
      'version: "0.1.0"',
      'entrypoint: "index.html"',
      "publicRoutes:",
      "  GET:",
      "    - /",
      "    - /**",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(sourceDir, "index.html"),
    [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '  <meta charset="utf-8" />',
      `  <title>${appName}</title>`,
      "</head>",
      "<body>",
      `  <main data-testid="landing-root">Landing deployed for ${appName}</main>`,
      "</body>",
      "</html>",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(sourceDir, "package.json"),
    `${JSON.stringify({ name: appName, version: "0.1.0" }, null, 2)}\n`,
  );

  return {
    appName,
    archivePath: await zipDirectory(sourceDir, join(runtime.paths.root, `${appName}.zip`)),
  };
}

export async function createInvalidAppArchive(runtime: RuntimeInstance): Promise<string> {
  const sourceDir = join(runtime.paths.root, "packages", archiveName("invalid-app"));
  await mkdir(sourceDir, { recursive: true });
  await writeFile(join(sourceDir, "manifest.yaml"), 'name: "invalid-app"\nversion: "0.1.0"\n');
  return zipDirectory(sourceDir, join(runtime.paths.root, "invalid-app.zip"));
}

export async function createRequestLoggerPluginArchive(
  runtime: RuntimeInstance,
  pluginName = archiveName("plugin-request-logger-e2e"),
): Promise<{ archivePath: string; pluginName: string }> {
  const sourceDir = join(runtime.paths.root, "packages", pluginName);
  await mkdir(sourceDir, { recursive: true });
  await writeFile(
    join(sourceDir, "manifest.yaml"),
    [
      `name: "${pluginName}"`,
      'version: "0.1.0"',
      `base: "/${pluginName}"`,
      'pluginEntry: "plugin.ts"',
      "",
    ].join("\n"),
  );
  await writeFile(
    join(sourceDir, "plugin.ts"),
    [
      'import { appendFile } from "node:fs/promises";',
      "",
      "export default function requestLoggerPlugin() {",
      "  return {",
      "    async onRequest(req, app) {",
      "      const logFile = Bun.env.E2E_REQUEST_LOG_FILE;",
      "      if (logFile) {",
      "        const url = new URL(req.url);",
      "        await appendFile(",
      "          logFile,",
      "          `${JSON.stringify({ app: app?.name ?? null, method: req.method, path: url.pathname })}\\n`,",
      "        );",
      "      }",
      "      return req;",
      "    },",
      "  };",
      "}",
      "",
    ].join("\n"),
  );

  return {
    archivePath: await zipDirectory(sourceDir, join(runtime.paths.root, `${pluginName}.zip`)),
    pluginName,
  };
}

export async function createInvalidPluginArchive(runtime: RuntimeInstance): Promise<string> {
  const sourceDir = join(runtime.paths.root, "packages", archiveName("invalid-plugin"));
  await mkdir(sourceDir, { recursive: true });
  await writeFile(
    join(sourceDir, "plugin.ts"),
    "export default function invalidPlugin() { return {}; }\n",
  );
  return zipDirectory(sourceDir, join(runtime.paths.root, "invalid-plugin.zip"));
}

export async function readLoggedRequests(runtime: RuntimeInstance): Promise<
  LoggedRequest[]
> {
  const text = await readFile(runtime.requestLogFile, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function waitForLoggedRequest(
  runtime: RuntimeInstance,
  predicate: (entry: LoggedRequest) => boolean,
): Promise<void> {
  await expect
    .poll(async () => (await readLoggedRequests(runtime)).some(predicate), { timeout: 10_000 })
    .toBe(true);
}

export async function runtimeJson<T>(
  runtime: RuntimeInstance,
  path: string,
  init: RequestInit = {},
  apiKey = runtime.masterKey,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-API-Key", apiKey);

  const response = await fetch(`${runtime.baseURL}${runtime.apiPath}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} failed with ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

export async function createApiKey(
  runtime: RuntimeInstance,
  input: {
    name: string;
    permissions?: string[];
    role: "admin" | "custom" | "editor" | "viewer";
  },
): Promise<string> {
  const response = await runtimeJson<{ data: { key: string } }>(
    runtime,
    "/keys",
    {
      body: JSON.stringify({ expiresIn: "1y", ...input }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );

  return response.data.key;
}

export const test = base.extend<{ runtime: RuntimeInstance }>({
  runtime: async ({}, use) => {
    const runtime = await startRuntime();
    try {
      await use(runtime);
    } finally {
      await runtime.stop();
    }
  },
});

export { expect };
