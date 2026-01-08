import { describe, expect, it } from "bun:test";
import { getShortName } from "./plugins";

describe("plugins utils", () => {
  describe("getShortName", () => {
    it("should extract short name from @buntime/plugin-* format", () => {
      expect(getShortName("@buntime/plugin-keyval")).toBe("keyval");
      expect(getShortName("@buntime/plugin-metrics")).toBe("metrics");
      expect(getShortName("@buntime/plugin-authn")).toBe("authn");
    });

    it("should extract short name from @buntime/* format", () => {
      expect(getShortName("@buntime/keyval")).toBe("keyval");
      expect(getShortName("@buntime/metrics")).toBe("metrics");
    });

    it("should extract short name from @other/plugin-* format", () => {
      expect(getShortName("@other/plugin-foo")).toBe("foo");
      expect(getShortName("@custom/plugin-bar")).toBe("bar");
    });

    it("should extract short name from @scope/* format", () => {
      expect(getShortName("@scope/my-package")).toBe("my-package");
    });

    it("should handle names with hyphens", () => {
      expect(getShortName("@buntime/plugin-my-cool-plugin")).toBe("my-cool-plugin");
    });

    it("should handle names with numbers", () => {
      expect(getShortName("@buntime/plugin-v2")).toBe("v2");
      expect(getShortName("@buntime/plugin-123")).toBe("123");
    });

    it("should throw for names with path traversal characters", () => {
      expect(() => getShortName("@buntime/plugin-../etc")).toThrow(/invalid characters/i);
      expect(() => getShortName("@buntime/plugin-foo/bar")).toThrow(/invalid characters/i);
      expect(() => getShortName("@buntime/plugin-foo..bar")).toThrow(/invalid characters/i);
    });

    it("should throw for names with special characters", () => {
      expect(() => getShortName("@buntime/plugin-foo@bar")).toThrow(/invalid characters/i);
      expect(() => getShortName("@buntime/plugin-foo#bar")).toThrow(/invalid characters/i);
      expect(() => getShortName("@buntime/plugin-foo$bar")).toThrow(/invalid characters/i);
    });

    it("should throw for names with spaces", () => {
      expect(() => getShortName("@buntime/plugin-foo bar")).toThrow(/invalid characters/i);
    });

    it("should handle uppercase in names", () => {
      expect(getShortName("@buntime/plugin-MyPlugin")).toBe("MyPlugin");
    });
  });
});
