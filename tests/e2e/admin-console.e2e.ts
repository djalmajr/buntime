import type { Page } from "@playwright/test";
import {
  createApiKey,
  createInvalidAppArchive,
  createInvalidPluginArchive,
  createLandingAppArchive,
  createRequestLoggerPluginArchive,
  expect,
  runtimeJson,
  startRuntime,
  test,
  waitForLoggedRequest,
  type RuntimeInstance,
} from "./fixtures/runtime.ts";

interface BrowserFetchResult {
  body: string;
  json?: unknown;
  status: number;
  url: string;
}

function adminUrl(runtime: RuntimeInstance): string {
  return `${runtime.baseURL}/cpanel/admin`;
}

async function login(page: Page, runtime: RuntimeInstance, apiKey: string): Promise<void> {
  await page.goto(adminUrl(runtime));
  await page.getByLabel("API key").fill(apiKey);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes(`${runtime.apiPath}/admin/session`) && response.status() === 200,
    ),
    page.getByRole("button", { name: "Enter" }).click(),
  ]);
  await expect(page.getByText("Administrative capabilities")).toBeVisible();
}

async function openAdminTab(page: Page, tabName: "Apps" | "Keys" | "Plugins"): Promise<void> {
  await page.getByRole("button", { name: tabName }).click();
  await expect(page.locator("header")).toContainText(tabName);
}

async function createKeyThroughUi(
  page: Page,
  input: {
    name: string;
    permissions?: string[];
    role: "admin" | "custom" | "editor" | "viewer";
  },
): Promise<string> {
  await openAdminTab(page, "Keys");
  await page.getByRole("button", { name: "New key" }).click();

  const dialog = page.getByRole("dialog", { name: "New key" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill(input.name);
  await dialog.getByLabel("Description").fill(`${input.name} created by Playwright`);
  await dialog.getByLabel("Role").selectOption(input.role);

  if (input.role === "custom") {
    for (const permission of input.permissions ?? []) {
      await expect(dialog.getByLabel(permission)).toBeVisible();
      await dialog.getByLabel(permission).check();
    }
  }

  await dialog.getByRole("button", { name: "Create key" }).click();
  const secret = dialog.getByLabel("Generated secret");
  await expect(secret).toHaveValue(/^btk_/);
  const key = await secret.inputValue();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  return key;
}

async function browserRuntimeFetch(
  page: Page,
  runtime: RuntimeInstance,
  path: string,
  options: {
    apiKey?: string | null;
    body?: string;
    contentType?: string;
    formData?: boolean;
    headers?: Record<string, string>;
    method?: string;
  } = {},
): Promise<BrowserFetchResult> {
  return page.evaluate(
    async ({ apiKey, apiPath, body, contentType, formData, headers, method, path }) => {
      const requestHeaders = new Headers(headers);
      let requestBody: BodyInit | undefined = body;

      if (apiKey) requestHeaders.set("X-API-Key", apiKey);
      if (contentType) requestHeaders.set("Content-Type", contentType);
      if (formData) requestBody = new FormData();

      const response = await fetch(`${apiPath}${path}`, {
        body: requestBody,
        headers: requestHeaders,
        method: method ?? "GET",
      });
      const text = await response.text();
      let json: unknown;

      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }

      return {
        body: text,
        json,
        status: response.status,
        url: response.url,
      };
    },
    {
      apiKey: options.apiKey,
      apiPath: runtime.apiPath,
      body: options.body,
      contentType: options.contentType,
      formData: options.formData,
      headers: options.headers ?? {},
      method: options.method,
      path,
    },
  );
}

async function uploadArchiveFromAdmin(
  page: Page,
  runtime: RuntimeInstance,
  kind: "app" | "plugin",
  archivePath: string,
): Promise<void> {
  const title = kind === "app" ? "Upload app" : "Upload plugin";
  const responsePath = kind === "app" ? "/apps/upload" : "/plugins/upload";

  await page.getByRole("button", { name: title }).click();
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles(archivePath);
  await expect(dialog.getByText(/Archive ready to upload/)).toBeVisible();

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes(`${runtime.apiPath}${responsePath}`) && response.status() === 200,
    ),
    dialog.getByRole("button", { name: "Upload" }).click(),
  ]);
  await expect(dialog).toBeHidden();
}

async function uploadInvalidArchiveFromAdmin(
  page: Page,
  kind: "app" | "plugin",
  archivePath: string,
  expectedMessage: string | RegExp,
): Promise<void> {
  const title = kind === "app" ? "Upload app" : "Upload plugin";

  await page.getByRole("button", { name: title }).click();
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles(archivePath);
  await expect(dialog.getByText(expectedMessage)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Upload" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

test("admin UI creates API keys and the runtime enforces their permissions", async ({
  page,
  runtime,
}) => {
  const sessionHeaders: Array<Record<string, string>> = [];
  page.on("request", (request) => {
    if (request.url().includes(`${runtime.apiPath}/admin/session`)) {
      sessionHeaders.push(request.headers());
    }
  });

  await login(page, runtime, runtime.masterKey);

  const loginSessionHeaders = sessionHeaders.at(-1);
  expect(loginSessionHeaders?.["x-api-key"]).toBe(runtime.masterKey);
  expect(loginSessionHeaders?.authorization).toBeUndefined();

  const bearerOnly = await browserRuntimeFetch(page, runtime, "/admin/session", {
    headers: { Authorization: `Bearer ${runtime.masterKey}` },
  });
  expect(bearerOnly.status).toBe(401);

  const adminKey = await createKeyThroughUi(page, {
    name: "e2e-admin",
    role: "admin",
  });
  const editorKey = await createKeyThroughUi(page, {
    name: "e2e-editor",
    role: "editor",
  });
  const viewerKey = await createKeyThroughUi(page, {
    name: "e2e-viewer",
    role: "viewer",
  });
  const customKey = await createKeyThroughUi(page, {
    name: "e2e-custom-readonly",
    permissions: ["apps:read", "plugins:read"],
    role: "custom",
  });

  const adminSession = await browserRuntimeFetch(page, runtime, "/admin/session", {
    apiKey: adminKey,
  });
  const editorSession = await browserRuntimeFetch(page, runtime, "/admin/session", {
    apiKey: editorKey,
  });
  const viewerSession = await browserRuntimeFetch(page, runtime, "/admin/session", {
    apiKey: viewerKey,
  });
  const customSession = await browserRuntimeFetch(page, runtime, "/admin/session", {
    apiKey: customKey,
  });

  expect(adminSession.body).toContain("keys:create");
  expect(editorSession.body).toContain("apps:install");
  expect(editorSession.body).not.toContain("keys:create");
  expect(viewerSession.body).toContain("keys:read");
  expect(viewerSession.body).not.toContain("apps:install");
  expect(customSession.body).toContain("apps:read");
  expect(customSession.body).not.toContain("apps:install");

  const editorCreateKey = await browserRuntimeFetch(page, runtime, "/keys", {
    apiKey: editorKey,
    body: JSON.stringify({ name: "editor-should-not-create", role: "viewer" }),
    contentType: "application/json",
    method: "POST",
  });
  expect(editorCreateKey.status).toBe(403);
  expect(editorCreateKey.body).toContain("keys:create");

  const viewerUpload = await browserRuntimeFetch(page, runtime, "/apps/upload", {
    apiKey: viewerKey,
    formData: true,
    method: "POST",
  });
  expect(viewerUpload.status).toBe(403);
  expect(viewerUpload.body).toContain("apps:install");
});

test("admin UI validates app archives, deploys a landing app, and keeps built-ins read-only", async ({
  page,
  runtime,
}) => {
  const editorKey = await createApiKey(runtime, { name: "app-deployer", role: "editor" });
  await login(page, runtime, editorKey);
  await openAdminTab(page, "Apps");

  const cpanelRow = page.locator("tbody tr").filter({ hasText: "cpanel" });
  await expect(cpanelRow).toContainText("Built-in");

  const builtInDelete = await browserRuntimeFetch(page, runtime, "/apps/_/cpanel", {
    apiKey: editorKey,
    method: "DELETE",
  });
  expect(builtInDelete.status).toBe(403);
  expect(builtInDelete.body).toContain("BUILT_IN_APP_REMOVE_FORBIDDEN");

  await uploadInvalidArchiveFromAdmin(
    page,
    "app",
    await createInvalidAppArchive(runtime),
    /must include index\.html/,
  );

  const { appName, archivePath } = await createLandingAppArchive(runtime);
  await uploadArchiveFromAdmin(page, runtime, "app", archivePath);

  const uploadedRow = page.locator("tbody tr").filter({ hasText: appName });
  await expect(uploadedRow).toContainText("Uploaded");
  await expect(uploadedRow).toContainText("0.1.0");

  await page.goto(`${runtime.baseURL}/${appName}/`);
  await expect(page.getByTestId("landing-root")).toHaveText(`Landing deployed for ${appName}`);

  await page.goto(adminUrl(runtime));
  await openAdminTab(page, "Apps");
  await page.getByPlaceholder("Search apps...").fill(appName);
  const rowAfterSearch = page.locator("tbody tr").filter({ hasText: appName });
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes(`${runtime.apiPath}/apps/_/${appName}`) &&
        response.request().method() === "DELETE" &&
        response.status() === 200,
    ),
    rowAfterSearch.getByRole("button", { exact: true, name: "Remove" }).click(),
  ]);
  await expect(page.getByText(`No results for "${appName}".`)).toBeVisible();

  const apps = await runtimeJson<Array<{ name: string }>>(runtime, "/apps", {}, editorKey);
  expect(apps.some((app) => app.name === appName)).toBe(false);
});

test("admin UI validates plugin archives, loads a request logger plugin, and removes uploaded plugins", async ({
  page,
  runtime,
}) => {
  const editorKey = await createApiKey(runtime, { name: "plugin-deployer", role: "editor" });
  const { appName, archivePath: appArchivePath } = await createLandingAppArchive(runtime);

  await login(page, runtime, editorKey);
  await openAdminTab(page, "Apps");
  await uploadArchiveFromAdmin(page, runtime, "app", appArchivePath);

  await openAdminTab(page, "Plugins");

  const builtInPluginRow = page.locator("tbody tr").filter({ hasText: "plugin-builtin-audit" });
  await expect(builtInPluginRow).toContainText("Built-in");

  const builtInDelete = await browserRuntimeFetch(page, runtime, "/plugins/plugin-builtin-audit", {
    apiKey: editorKey,
    method: "DELETE",
  });
  expect(builtInDelete.status).toBe(403);
  expect(builtInDelete.body).toContain("BUILT_IN_PLUGIN_REMOVE_FORBIDDEN");

  await uploadInvalidArchiveFromAdmin(
    page,
    "plugin",
    await createInvalidPluginArchive(runtime),
    /must include manifest\.yaml/,
  );

  const { archivePath: pluginArchivePath, pluginName } =
    await createRequestLoggerPluginArchive(runtime);
  await uploadArchiveFromAdmin(page, runtime, "plugin", pluginArchivePath);

  await page.getByPlaceholder("Search plugins...").fill(pluginName);
  const pluginRow = page.locator("tbody tr").filter({ hasText: pluginName });
  await expect(pluginRow).toContainText("Uploaded");
  await expect(pluginRow).toContainText("Loaded");

  await page.goto(`${runtime.baseURL}/${appName}/`);
  await expect(page.getByTestId("landing-root")).toHaveText(`Landing deployed for ${appName}`);
  await waitForLoggedRequest(
    runtime,
    (entry) => entry.app === appName && entry.path === `/${appName}/`,
  );

  await page.goto(adminUrl(runtime));
  await openAdminTab(page, "Plugins");
  await page.getByPlaceholder("Search plugins...").fill(pluginName);
  const uploadedPluginRow = page.locator("tbody tr").filter({ hasText: pluginName });
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes(`${runtime.apiPath}/plugins/${pluginName}`) &&
        response.request().method() === "DELETE" &&
        response.status() === 200,
    ),
    uploadedPluginRow.getByRole("button", { name: "Remove" }).click(),
  ]);
  await expect(page.getByText(`No results for "${pluginName}".`)).toBeVisible();
  const plugins = await runtimeJson<Array<{ name: string }>>(runtime, "/plugins", {}, editorKey);
  expect(plugins.some((plugin) => plugin.name === pluginName)).toBe(false);
});

test("admin UI discovers prefixed runtime APIs before authenticating", async ({ page }) => {
  const runtime = await startRuntime({ apiPrefix: "/_" });
  const sessionUrls: string[] = [];

  try {
    page.on("request", (request) => {
      if (request.url().includes("/admin/session")) {
        sessionUrls.push(request.url());
      }
    });

    await login(page, runtime, runtime.masterKey);

    expect(sessionUrls.some((url) => url.includes("/_/api/admin/session"))).toBe(true);
    await expect(page.getByText("Master key", { exact: true })).toBeVisible();
  } finally {
    await runtime.stop();
  }
});
