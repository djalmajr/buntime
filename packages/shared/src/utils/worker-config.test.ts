import { describe, expect, it } from "bun:test";
import { parseWorkerConfig, WorkerConfigDefaults } from "./worker-config";

describe("WorkerConfigDefaults", () => {
  it("should have correct default values", () => {
    expect(WorkerConfigDefaults.autoInstall).toBe(false);
    expect(WorkerConfigDefaults.idleTimeout).toBe(60);
    expect(WorkerConfigDefaults.injectBase).toBe(false);
    expect(WorkerConfigDefaults.lowMemory).toBe(false);
    expect(WorkerConfigDefaults.maxRequests).toBe(1000);
    expect(WorkerConfigDefaults.timeout).toBe(30);
    expect(WorkerConfigDefaults.ttl).toBe(0);
  });

  it("should have all expected keys", () => {
    const keys = Object.keys(WorkerConfigDefaults).sort();
    expect(keys).toEqual([
      "autoInstall",
      "idleTimeout",
      "injectBase",
      "lowMemory",
      "maxRequests",
      "timeout",
      "ttl",
    ]);
  });

  it("should have idleTimeout in seconds", () => {
    expect(WorkerConfigDefaults.idleTimeout).toBe(60);
  });

  it("should have timeout in seconds", () => {
    expect(WorkerConfigDefaults.timeout).toBe(30);
  });

  it("should have ttl of 0 for ephemeral mode by default", () => {
    expect(WorkerConfigDefaults.ttl).toBe(0);
  });

  it("should have maxRequests for worker recycling", () => {
    expect(WorkerConfigDefaults.maxRequests).toBe(1000);
  });
});

describe("parseWorkerConfig", () => {
  it("should return defaults for empty/null manifest", () => {
    const config = parseWorkerConfig(null);

    expect(config.autoInstall).toBe(WorkerConfigDefaults.autoInstall);
    expect(config.injectBase).toBe(WorkerConfigDefaults.injectBase);
    expect(config.lowMemory).toBe(WorkerConfigDefaults.lowMemory);
    expect(config.maxRequests).toBe(WorkerConfigDefaults.maxRequests);
    expect(config.timeoutMs).toBe(WorkerConfigDefaults.timeout * 1000);
    expect(config.idleTimeoutMs).toBe(WorkerConfigDefaults.idleTimeout * 1000);
    expect(config.ttlMs).toBe(WorkerConfigDefaults.ttl * 1000);
    expect(config.maxBodySizeBytes).toBeUndefined();
  });

  it("should parse duration values in seconds", () => {
    const config = parseWorkerConfig({
      timeout: 60,
      idleTimeout: 120,
      ttl: 3600,
    });

    expect(config.timeoutMs).toBe(60000);
    expect(config.idleTimeoutMs).toBe(120000);
    expect(config.ttlMs).toBe(3600000);
  });

  it("should parse duration values as strings", () => {
    const config = parseWorkerConfig({
      timeout: "30s",
      idleTimeout: "2m",
      ttl: "1h",
    });

    expect(config.timeoutMs).toBe(30000);
    expect(config.idleTimeoutMs).toBe(120000);
    expect(config.ttlMs).toBe(3600000);
  });

  it("should parse size values in bytes", () => {
    const config = parseWorkerConfig({
      maxBodySize: 1048576,
    });

    expect(config.maxBodySizeBytes).toBe(1048576);
  });

  it("should parse size values as strings", () => {
    const config = parseWorkerConfig({
      maxBodySize: "50mb",
    });

    expect(config.maxBodySizeBytes).toBe(50 * 1024 * 1024);
  });

  it("should preserve entrypoint and env", () => {
    const config = parseWorkerConfig({
      entrypoint: "dist/index.html",
      env: {
        PUBLIC_API: "/api",
        PUBLIC_THEME: "dark",
      },
    });

    expect(config.entrypoint).toBe("dist/index.html");
    expect(config.env).toEqual({
      PUBLIC_API: "/api",
      PUBLIC_THEME: "dark",
    });
  });

  it("should parse injectBase", () => {
    const configTrue = parseWorkerConfig({ injectBase: true });
    const configFalse = parseWorkerConfig({ injectBase: false });

    expect(configTrue.injectBase).toBe(true);
    expect(configFalse.injectBase).toBe(false);
  });

  it("should parse publicRoutes array", () => {
    const config = parseWorkerConfig({
      publicRoutes: ["/api/health", "/api/public/**"],
    });

    expect(config.publicRoutes).toEqual(["/api/health", "/api/public/**"]);
  });

  it("should parse publicRoutes object", () => {
    const config = parseWorkerConfig({
      publicRoutes: {
        GET: ["/api/users"],
        POST: ["/api/webhook"],
      },
    });

    expect(config.publicRoutes).toEqual({
      GET: ["/api/users"],
      POST: ["/api/webhook"],
    });
  });
});
