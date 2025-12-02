import { describe, expect, it } from "bun:test";
import { ConfigDefaults } from "./config";

describe("ConfigDefaults", () => {
  it("should have correct default values", () => {
    expect(ConfigDefaults.autoInstall).toBe(false);
    expect(ConfigDefaults.idleTimeout).toBe(60);
    expect(ConfigDefaults.lowMemory).toBe(false);
    expect(ConfigDefaults.maxRequests).toBe(1000);
    expect(ConfigDefaults.timeout).toBe(30);
    expect(ConfigDefaults.ttl).toBe(0);
  });

  it("should have all expected keys", () => {
    const keys = Object.keys(ConfigDefaults).sort();
    expect(keys).toEqual([
      "autoInstall",
      "idleTimeout",
      "lowMemory",
      "maxRequests",
      "timeout",
      "ttl",
    ]);
  });
});
