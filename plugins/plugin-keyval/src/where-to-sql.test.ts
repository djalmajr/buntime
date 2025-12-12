import { describe, expect, it } from "bun:test";
import { whereToSql } from "./where-to-sql";

describe("whereToSql", () => {
  describe("basic operators", () => {
    it("should handle $eq operator", () => {
      const result = whereToSql({ status: { $eq: "active" } });

      expect(result.sql).toBe("json_extract(value, '$.status') = ?");
      expect(result.params).toEqual(["active"]);
    });

    it("should handle shorthand $eq (direct value)", () => {
      const result = whereToSql({ status: "active" });

      expect(result.sql).toBe("json_extract(value, '$.status') = ?");
      expect(result.params).toEqual(["active"]);
    });

    it("should handle $ne operator", () => {
      const result = whereToSql({ status: { $ne: "deleted" } });

      expect(result.sql).toBe("json_extract(value, '$.status') != ?");
      expect(result.params).toEqual(["deleted"]);
    });

    it("should handle $gt operator", () => {
      const result = whereToSql({ age: { $gt: 18 } });

      expect(result.sql).toBe("json_extract(value, '$.age') > ?");
      expect(result.params).toEqual([18]);
    });

    it("should handle $gte operator", () => {
      const result = whereToSql({ age: { $gte: 18 } });

      expect(result.sql).toBe("json_extract(value, '$.age') >= ?");
      expect(result.params).toEqual([18]);
    });

    it("should handle $lt operator", () => {
      const result = whereToSql({ price: { $lt: 100 } });

      expect(result.sql).toBe("json_extract(value, '$.price') < ?");
      expect(result.params).toEqual([100]);
    });

    it("should handle $lte operator", () => {
      const result = whereToSql({ price: { $lte: 100 } });

      expect(result.sql).toBe("json_extract(value, '$.price') <= ?");
      expect(result.params).toEqual([100]);
    });

    it("should handle $in operator", () => {
      const result = whereToSql({ status: { $in: ["active", "pending"] } });

      expect(result.sql).toBe("json_extract(value, '$.status') IN (?, ?)");
      expect(result.params).toEqual(["active", "pending"]);
    });

    it("should handle $nin operator", () => {
      const result = whereToSql({ status: { $nin: ["deleted", "banned"] } });

      expect(result.sql).toBe("json_extract(value, '$.status') NOT IN (?, ?)");
      expect(result.params).toEqual(["deleted", "banned"]);
    });

    it("should handle $null true", () => {
      const result = whereToSql({ deletedAt: { $null: true } });

      expect(result.sql).toBe("json_extract(value, '$.deletedAt') IS NULL");
      expect(result.params).toEqual([]);
    });

    it("should handle $null false", () => {
      const result = whereToSql({ email: { $null: false } });

      expect(result.sql).toBe("json_extract(value, '$.email') IS NOT NULL");
      expect(result.params).toEqual([]);
    });
  });

  describe("nested fields", () => {
    it("should handle dot notation", () => {
      const result = whereToSql({ "profile.verified": { $eq: true } });

      expect(result.sql).toBe("json_extract(value, '$.profile.verified') = ?");
      expect(result.params).toEqual([true]);
    });

    it("should handle deeply nested fields", () => {
      const result = whereToSql({
        "settings.notifications.email": { $eq: false },
      });

      expect(result.sql).toBe("json_extract(value, '$.settings.notifications.email') = ?");
      expect(result.params).toEqual([false]);
    });

    it("should handle array access", () => {
      const result = whereToSql({ "items[0].price": { $gt: 100 } });

      expect(result.sql).toBe("json_extract(value, '$.items[0].price') > ?");
      expect(result.params).toEqual([100]);
    });
  });

  describe("logical operators", () => {
    it("should handle $and", () => {
      const result = whereToSql({
        $and: [{ status: { $eq: "active" } }, { age: { $gte: 18 } }],
      });

      expect(result.sql).toBe(
        "((json_extract(value, '$.status') = ?) AND (json_extract(value, '$.age') >= ?))",
      );
      expect(result.params).toEqual(["active", 18]);
    });

    it("should handle $or", () => {
      const result = whereToSql({
        $or: [{ status: { $eq: "pending" } }, { status: { $eq: "processing" } }],
      });

      expect(result.sql).toBe(
        "((json_extract(value, '$.status') = ?) OR (json_extract(value, '$.status') = ?))",
      );
      expect(result.params).toEqual(["pending", "processing"]);
    });

    it("should handle $not", () => {
      const result = whereToSql({
        $not: { status: { $eq: "deleted" } },
      });

      expect(result.sql).toBe("NOT (json_extract(value, '$.status') = ?)");
      expect(result.params).toEqual(["deleted"]);
    });

    it("should handle nested logical operators", () => {
      const result = whereToSql({
        $or: [
          { $and: [{ status: { $eq: "active" } }, { verified: { $eq: true } }] },
          { role: { $eq: "admin" } },
        ],
      });

      expect(result.sql).toContain("OR");
      expect(result.sql).toContain("AND");
      expect(result.params).toEqual(["active", true, "admin"]);
    });
  });

  describe("multiple conditions", () => {
    it("should AND multiple field conditions implicitly", () => {
      const result = whereToSql({
        status: { $eq: "active" },
        age: { $gte: 18 },
      });

      expect(result.sql).toBe(
        "json_extract(value, '$.status') = ? AND json_extract(value, '$.age') >= ?",
      );
      expect(result.params).toEqual(["active", 18]);
    });

    it("should handle multiple operators on same field", () => {
      const result = whereToSql({
        age: { $gte: 18, $lte: 65 },
      });

      expect(result.sql).toBe(
        "json_extract(value, '$.age') >= ? AND json_extract(value, '$.age') <= ?",
      );
      expect(result.params).toEqual([18, 65]);
    });
  });

  describe("edge cases", () => {
    it("should return 1=1 for empty filter", () => {
      const result = whereToSql({});

      expect(result.sql).toBe("1=1");
      expect(result.params).toEqual([]);
    });

    it("should handle null values", () => {
      const result = whereToSql({ status: { $eq: null } });

      expect(result.sql).toBe("json_extract(value, '$.status') = ?");
      expect(result.params).toEqual([null]);
    });

    it("should handle boolean values", () => {
      const result = whereToSql({ active: { $eq: true } });

      expect(result.sql).toBe("json_extract(value, '$.active') = ?");
      expect(result.params).toEqual([true]);
    });

    it("should handle numeric values", () => {
      const result = whereToSql({ count: { $eq: 42 } });

      expect(result.sql).toBe("json_extract(value, '$.count') = ?");
      expect(result.params).toEqual([42]);
    });

    it("should skip undefined values", () => {
      const result = whereToSql({ status: undefined, active: { $eq: true } });

      expect(result.sql).toBe("json_extract(value, '$.active') = ?");
      expect(result.params).toEqual([true]);
    });
  });

  describe("$now placeholder", () => {
    it("should resolve $now in $lt operator", () => {
      const before = Date.now();
      const result = whereToSql({ expiresAt: { $lt: { $now: true } } });
      const after = Date.now();

      expect(result.sql).toBe("json_extract(value, '$.expiresAt') < ?");
      expect(result.params.length).toBe(1);
      expect(result.params[0]).toBeGreaterThanOrEqual(before);
      expect(result.params[0]).toBeLessThanOrEqual(after);
    });

    it("should resolve $now in $lte operator", () => {
      const before = Date.now();
      const result = whereToSql({ deadline: { $lte: { $now: true } } });
      const after = Date.now();

      expect(result.sql).toBe("json_extract(value, '$.deadline') <= ?");
      expect(result.params.length).toBe(1);
      expect(result.params[0]).toBeGreaterThanOrEqual(before);
      expect(result.params[0]).toBeLessThanOrEqual(after);
    });

    it("should resolve $now in $gt operator", () => {
      const before = Date.now();
      const result = whereToSql({ createdAt: { $gt: { $now: true } } });
      const after = Date.now();

      expect(result.sql).toBe("json_extract(value, '$.createdAt') > ?");
      expect(result.params.length).toBe(1);
      expect(result.params[0]).toBeGreaterThanOrEqual(before);
      expect(result.params[0]).toBeLessThanOrEqual(after);
    });

    it("should resolve $now in $gte operator", () => {
      const before = Date.now();
      const result = whereToSql({ validFrom: { $gte: { $now: true } } });
      const after = Date.now();

      expect(result.sql).toBe("json_extract(value, '$.validFrom') >= ?");
      expect(result.params.length).toBe(1);
      expect(result.params[0]).toBeGreaterThanOrEqual(before);
      expect(result.params[0]).toBeLessThanOrEqual(after);
    });

    it("should resolve $now in complex $or condition", () => {
      const before = Date.now();
      const result = whereToSql({
        $or: [{ status: { $eq: "expired" } }, { expiresAt: { $lt: { $now: true } } }],
      });
      const after = Date.now();

      expect(result.sql).toBe(
        "((json_extract(value, '$.status') = ?) OR (json_extract(value, '$.expiresAt') < ?))",
      );
      expect(result.params.length).toBe(2);
      expect(result.params[0]).toBe("expired");
      expect(result.params[1]).toBeGreaterThanOrEqual(before);
      expect(result.params[1]).toBeLessThanOrEqual(after);
    });

    it("should handle $now with other operators on same field", () => {
      const oneHourAgo = Date.now() - 3600000;
      const before = Date.now();
      const result = whereToSql({
        timestamp: { $gt: oneHourAgo, $lt: { $now: true } },
      });
      const after = Date.now();

      expect(result.sql).toBe(
        "json_extract(value, '$.timestamp') > ? AND json_extract(value, '$.timestamp') < ?",
      );
      expect(result.params.length).toBe(2);
      expect(result.params[0]).toBe(oneHourAgo);
      expect(result.params[1]).toBeGreaterThanOrEqual(before);
      expect(result.params[1]).toBeLessThanOrEqual(after);
    });
  });

  describe("$between operator", () => {
    it("should handle $between with numbers", () => {
      const result = whereToSql({ amount: { $between: [100, 500] } });

      expect(result.sql).toBe("json_extract(value, '$.amount') BETWEEN ? AND ?");
      expect(result.params).toEqual([100, 500]);
    });

    it("should handle $between with strings", () => {
      const result = whereToSql({ date: { $between: ["2024-01-01", "2024-12-31"] } });

      expect(result.sql).toBe("json_extract(value, '$.date') BETWEEN ? AND ?");
      expect(result.params).toEqual(["2024-01-01", "2024-12-31"]);
    });
  });

  describe("string operators (case-sensitive)", () => {
    it("should handle $contains using instr for case-sensitivity", () => {
      const result = whereToSql({ name: { $contains: "Silva" } });

      expect(result.sql).toBe("instr(json_extract(value, '$.name'), ?) > 0");
      expect(result.params).toEqual(["Silva"]);
    });

    it("should handle $notContains using instr", () => {
      const result = whereToSql({ email: { $notContains: "@temp" } });

      expect(result.sql).toBe("instr(json_extract(value, '$.email'), ?) = 0");
      expect(result.params).toEqual(["@temp"]);
    });

    it("should handle $startsWith using substr", () => {
      const result = whereToSql({ code: { $startsWith: "BR-" } });

      expect(result.sql).toBe("substr(json_extract(value, '$.code'), 1, 3) = ?");
      expect(result.params).toEqual(["BR-"]);
    });

    it("should handle $endsWith using substr", () => {
      const result = whereToSql({ email: { $endsWith: "@company.com" } });

      expect(result.sql).toBe("substr(json_extract(value, '$.email'), -12) = ?");
      expect(result.params).toEqual(["@company.com"]);
    });

    it("should handle special characters in $contains (no escaping needed)", () => {
      const result = whereToSql({ pattern: { $contains: "100%" } });

      expect(result.sql).toBe("instr(json_extract(value, '$.pattern'), ?) > 0");
      expect(result.params).toEqual(["100%"]);
    });

    it("should handle special characters in $startsWith", () => {
      const result = whereToSql({ name: { $startsWith: "user_" } });

      expect(result.sql).toBe("substr(json_extract(value, '$.name'), 1, 5) = ?");
      expect(result.params).toEqual(["user_"]);
    });
  });

  describe("string operators (case-insensitive)", () => {
    it("should handle $containsi", () => {
      const result = whereToSql({ name: { $containsi: "Silva" } });

      expect(result.sql).toBe("LOWER(json_extract(value, '$.name')) LIKE ? ESCAPE '\\'");
      expect(result.params).toEqual(["%silva%"]);
    });

    it("should handle $notContainsi", () => {
      const result = whereToSql({ name: { $notContainsi: "Test" } });

      expect(result.sql).toBe("LOWER(json_extract(value, '$.name')) NOT LIKE ? ESCAPE '\\'");
      expect(result.params).toEqual(["%test%"]);
    });

    it("should handle $startsWithi", () => {
      const result = whereToSql({ code: { $startsWithi: "BR_" } });

      expect(result.sql).toBe("LOWER(json_extract(value, '$.code')) LIKE ? ESCAPE '\\'");
      expect(result.params).toEqual(["br\\_%"]);
    });

    it("should handle $endsWithi", () => {
      const result = whereToSql({ domain: { $endsWithi: ".COM.BR" } });

      expect(result.sql).toBe("LOWER(json_extract(value, '$.domain')) LIKE ? ESCAPE '\\'");
      expect(result.params).toEqual(["%.com.br"]);
    });
  });

  describe("$empty and $notEmpty operators", () => {
    it("should handle $empty true", () => {
      const result = whereToSql({ tags: { $empty: true } });

      expect(result.sql).toContain("IS NULL");
      expect(result.sql).toContain("= ''");
      expect(result.sql).toContain("json_valid");
      expect(result.sql).toContain("json_array_length");
      expect(result.params).toEqual([]);
    });

    it("should handle $empty false", () => {
      const result = whereToSql({ description: { $empty: false } });

      expect(result.sql).toContain("IS NOT NULL");
      expect(result.sql).toContain("!= ''");
      expect(result.params).toEqual([]);
    });

    it("should handle $notEmpty true", () => {
      const result = whereToSql({ content: { $notEmpty: true } });

      expect(result.sql).toContain("IS NOT NULL");
      expect(result.sql).toContain("!= ''");
      expect(result.params).toEqual([]);
    });

    it("should handle $notEmpty false", () => {
      const result = whereToSql({ data: { $notEmpty: false } });

      expect(result.sql).toContain("IS NULL");
      expect(result.sql).toContain("= ''");
      expect(result.params).toEqual([]);
    });
  });

  describe("combined new operators", () => {
    it("should combine $between with other operators", () => {
      const result = whereToSql({
        amount: { $between: [100, 500] },
        status: { $eq: "active" },
      });

      expect(result.sql).toContain("BETWEEN ? AND ?");
      expect(result.sql).toContain("= ?");
      expect(result.params).toEqual([100, 500, "active"]);
    });

    it("should combine string operators in $or", () => {
      const result = whereToSql({
        $or: [{ name: { $containsi: "silva" } }, { email: { $endsWithi: "@gmail.com" } }],
      });

      expect(result.sql).toContain("LOWER(json_extract(value, '$.name'))");
      expect(result.sql).toContain("LOWER(json_extract(value, '$.email'))");
      expect(result.params).toEqual(["%silva%", "%@gmail.com"]);
    });

    it("should handle complex filter with multiple new operators", () => {
      const result = whereToSql({
        $and: [
          { price: { $between: [10, 100] } },
          { name: { $startsWithi: "product" } },
          { tags: { $notEmpty: true } },
        ],
      });

      expect(result.sql).toContain("BETWEEN ? AND ?");
      expect(result.sql).toContain("LOWER(json_extract(value, '$.name'))");
      expect(result.sql).toContain("IS NOT NULL");
      expect(result.params).toContain(10);
      expect(result.params).toContain(100);
      expect(result.params).toContain("product%");
    });
  });
});
