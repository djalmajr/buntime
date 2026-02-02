import { describe, expect, it } from "bun:test";
import { createWellKnownRoutes, type RuntimeInfo } from "./well-known";

describe("createWellKnownRoutes", () => {
  describe("GET /buntime", () => {
    it("should return runtime info with api and version", async () => {
      const routes = createWellKnownRoutes();
      const req = new Request("http://localhost/buntime");
      const res = await routes.fetch(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");

      const data = (await res.json()) as RuntimeInfo;
      expect(data).toHaveProperty("api");
      expect(data).toHaveProperty("version");
      expect(typeof data.api).toBe("string");
      expect(typeof data.version).toBe("string");
    });

    it("should return api path starting with /", async () => {
      const routes = createWellKnownRoutes();
      const req = new Request("http://localhost/buntime");
      const res = await routes.fetch(req);

      const data = (await res.json()) as RuntimeInfo;
      expect(data.api.startsWith("/")).toBe(true);
    });

    it("should return a valid semver-like version", async () => {
      const routes = createWellKnownRoutes();
      const req = new Request("http://localhost/buntime");
      const res = await routes.fetch(req);

      const data = (await res.json()) as RuntimeInfo;
      // Version should match semver pattern (x.y.z or x.y.z-prerelease)
      expect(data.version).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
    });

    it("should return 404 for unknown paths", async () => {
      const routes = createWellKnownRoutes();
      const req = new Request("http://localhost/unknown");
      const res = await routes.fetch(req);

      expect(res.status).toBe(404);
    });
  });
});
