import { describe, expect, it } from "bun:test";
import { parseAppPath } from "./app-path";

describe("parseAppPath", () => {
  it("returns null at the root", () => {
    expect(parseAppPath("/")).toBeNull();
    expect(parseAppPath("")).toBeNull();
    expect(parseAppPath("///")).toBeNull();
  });

  describe("unscoped workers", () => {
    it("parses a bare app name", () => {
      expect(parseAppPath("/checkout")).toEqual({
        name: "checkout",
        basePath: "/checkout",
        rest: "/",
      });
    });

    it("parses an app with a subpath", () => {
      expect(parseAppPath("/checkout/page")).toEqual({
        name: "checkout",
        basePath: "/checkout",
        rest: "/page",
      });
    });

    it("preserves a trailing slash on the subpath", () => {
      expect(parseAppPath("/checkout/")?.rest).toBe("/");
      expect(parseAppPath("/checkout/page/")?.rest).toBe("/page/");
    });
  });

  describe("namespaced workers", () => {
    it("parses @namespace/app as a two-segment name", () => {
      expect(parseAppPath("/@acme/checkout")).toEqual({
        name: "@acme/checkout",
        basePath: "/@acme/checkout",
        rest: "/",
      });
    });

    it("parses a namespaced app with a subpath", () => {
      expect(parseAppPath("/@acme/checkout/api/ping")).toEqual({
        name: "@acme/checkout",
        basePath: "/@acme/checkout",
        rest: "/api/ping",
      });
    });

    it("handles environment-style namespaces", () => {
      expect(parseAppPath("/@production/api")?.name).toBe("@production/api");
    });

    it("falls back to single segment when only the scope is present", () => {
      // `@scope` alone is not a valid worker name; resolves to nothing (404).
      expect(parseAppPath("/@acme")).toEqual({
        name: "@acme",
        basePath: "/@acme",
        rest: "/",
      });
    });
  });
});
