import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import z from "zod/v4";
import { boolean, number, substituteEnvVars } from "./zod-helpers";

describe("number helper", () => {
  describe("default value handling", () => {
    it("should return default value for empty string", () => {
      const schema = number(42);
      expect(schema.parse("")).toBe(42);
    });

    it("should return default value for null", () => {
      const schema = number(42);
      expect(schema.parse(null)).toBe(42);
    });

    it("should return default value for undefined", () => {
      const schema = number(42);
      expect(schema.parse(undefined)).toBe(42);
    });
  });

  describe("number parsing", () => {
    it("should parse valid number strings", () => {
      const schema = number(0);
      expect(schema.parse("123")).toBe(123);
      expect(schema.parse("0")).toBe(0);
      expect(schema.parse("-5")).toBe(-5);
    });

    it("should parse floating point strings", () => {
      const schema = number(0);
      expect(schema.parse("3.14")).toBe(3.14);
      expect(schema.parse("0.5")).toBe(0.5);
    });
  });

  describe("security - NaN/Infinity handling", () => {
    it("should return default for NaN input", () => {
      const schema = number(100);
      expect(schema.parse("not-a-number")).toBe(100);
      expect(schema.parse("abc")).toBe(100);
    });

    it("should return default for Infinity input", () => {
      const schema = number(100);
      expect(schema.parse("Infinity")).toBe(100);
      expect(schema.parse("-Infinity")).toBe(100);
    });
  });

  describe("custom schema validation", () => {
    it("should apply custom schema validations", () => {
      const schema = number(0, z.number().nonnegative());
      expect(schema.parse("10")).toBe(10);
      expect(() => schema.parse("-5")).toThrow();
    });

    it("should apply min/max validations", () => {
      const schema = number(50, z.number().min(0).max(100));
      expect(schema.parse("50")).toBe(50);
      expect(() => schema.parse("150")).toThrow();
    });
  });
});

describe("boolean helper", () => {
  describe("default value handling", () => {
    it("should return default value for empty string", () => {
      const schema = boolean(true);
      expect(schema.parse("")).toBe(true);

      const schemaFalse = boolean(false);
      expect(schemaFalse.parse("")).toBe(false);
    });

    it("should return default value for null", () => {
      const schema = boolean(true);
      expect(schema.parse(null)).toBe(true);
    });

    it("should return default value for undefined", () => {
      const schema = boolean(false);
      expect(schema.parse(undefined)).toBe(false);
    });
  });

  describe("boolean value parsing", () => {
    it("should pass through actual boolean values", () => {
      const schema = boolean(false);
      expect(schema.parse(true)).toBe(true);
      expect(schema.parse(false)).toBe(false);
    });

    it("should parse 'true' string as true", () => {
      const schema = boolean(false);
      expect(schema.parse("true")).toBe(true);
    });

    it("should parse '1' string as true", () => {
      const schema = boolean(false);
      expect(schema.parse("1")).toBe(true);
    });

    it("should parse 'false' string as false", () => {
      const schema = boolean(true);
      expect(schema.parse("false")).toBe(false);
    });

    it("should parse '0' string as false", () => {
      const schema = boolean(true);
      expect(schema.parse("0")).toBe(false);
    });

    it("should parse other strings as false", () => {
      const schema = boolean(false);
      expect(schema.parse("yes")).toBe(false);
      expect(schema.parse("no")).toBe(false);
      expect(schema.parse("random")).toBe(false);
    });
  });
});

describe("substituteEnvVars", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Set up test env vars
    process.env.TEST_VAR = "test-value";
    process.env.ANOTHER_VAR = "another-value";
    process.env.NUMERIC_VAR = "12345";
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  describe("variable substitution", () => {
    it("should substitute single variable", () => {
      const result = substituteEnvVars("Hello ${TEST_VAR}");
      expect(result).toBe("Hello test-value");
    });

    it("should substitute multiple variables", () => {
      const result = substituteEnvVars("${TEST_VAR} and ${ANOTHER_VAR}");
      expect(result).toBe("test-value and another-value");
    });

    it("should substitute same variable multiple times", () => {
      const result = substituteEnvVars("${TEST_VAR} ${TEST_VAR}");
      expect(result).toBe("test-value test-value");
    });
  });

  describe("missing variables", () => {
    it("should replace missing variable with empty string", () => {
      const result = substituteEnvVars("Value: ${NONEXISTENT_VAR}");
      expect(result).toBe("Value: ");
    });
  });

  describe("no substitution needed", () => {
    it("should return string unchanged if no variables", () => {
      const result = substituteEnvVars("No variables here");
      expect(result).toBe("No variables here");
    });

    it("should not substitute incomplete syntax", () => {
      const result = substituteEnvVars("$TEST_VAR without braces");
      expect(result).toBe("$TEST_VAR without braces");
    });
  });

  describe("edge cases", () => {
    it("should handle empty string", () => {
      const result = substituteEnvVars("");
      expect(result).toBe("");
    });

    it("should handle variable at start", () => {
      const result = substituteEnvVars("${TEST_VAR} at start");
      expect(result).toBe("test-value at start");
    });

    it("should handle variable at end", () => {
      const result = substituteEnvVars("at end ${TEST_VAR}");
      expect(result).toBe("at end test-value");
    });

    it("should handle only variable", () => {
      const result = substituteEnvVars("${TEST_VAR}");
      expect(result).toBe("test-value");
    });
  });
});
