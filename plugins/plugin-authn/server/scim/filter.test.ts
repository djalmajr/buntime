/**
 * Tests for SCIM filter parser
 *
 * Tests:
 * - Tokenization
 * - Filter parsing
 * - SQL generation
 * - Query building
 */

import { describe, expect, it } from "bun:test";
import { buildListQuery, parseFilter } from "./filter";

describe("parseFilter", () => {
  describe("empty and null filters", () => {
    it("should return 1=1 for empty filter", () => {
      const result = parseFilter("", "User");
      expect(result.where).toBe("1=1");
      expect(result.params).toEqual([]);
    });

    it("should return 1=1 for whitespace-only filter", () => {
      const result = parseFilter("   ", "User");
      expect(result.where).toBe("1=1");
      expect(result.params).toEqual([]);
    });
  });

  describe("equality operator (eq)", () => {
    it("should parse string equality", () => {
      const result = parseFilter('userName eq "john@example.com"', "User");
      expect(result.where).toBe("email = ?");
      expect(result.params).toEqual(["john@example.com"]);
    });

    it("should parse boolean equality (true)", () => {
      const result = parseFilter("active eq true", "User");
      expect(result.where).toBe("active = ?");
      expect(result.params).toEqual([1]);
    });

    it("should parse boolean equality (false)", () => {
      const result = parseFilter("active eq false", "User");
      expect(result.where).toBe("active = ?");
      expect(result.params).toEqual([0]);
    });

    it("should parse null equality", () => {
      const result = parseFilter("externalId eq null", "User");
      expect(result.where).toBe("externalId IS NULL");
      expect(result.params).toEqual([]);
    });

    it("should parse id equality", () => {
      const result = parseFilter('id eq "123-456"', "User");
      expect(result.where).toBe("id = ?");
      expect(result.params).toEqual(["123-456"]);
    });
  });

  describe("not equal operator (ne)", () => {
    it("should parse string not equal", () => {
      const result = parseFilter('userName ne "admin@example.com"', "User");
      expect(result.where).toBe("email != ?");
      expect(result.params).toEqual(["admin@example.com"]);
    });

    it("should parse null not equal", () => {
      const result = parseFilter("externalId ne null", "User");
      expect(result.where).toBe("externalId IS NOT NULL");
      expect(result.params).toEqual([]);
    });
  });

  describe("contains operator (co)", () => {
    it("should parse contains string", () => {
      const result = parseFilter('displayName co "Silva"', "User");
      expect(result.where).toBe("name LIKE ?");
      expect(result.params).toEqual(["%Silva%"]);
    });

    it("should parse contains on nested attribute", () => {
      const result = parseFilter('name.familyName co "Smith"', "User");
      expect(result.where).toBe("name LIKE ?");
      expect(result.params).toEqual(["%Smith%"]);
    });
  });

  describe("starts with operator (sw)", () => {
    it("should parse starts with string", () => {
      const result = parseFilter('userName sw "john"', "User");
      expect(result.where).toBe("email LIKE ?");
      expect(result.params).toEqual(["john%"]);
    });
  });

  describe("ends with operator (ew)", () => {
    it("should parse ends with string", () => {
      const result = parseFilter('userName ew "@example.com"', "User");
      expect(result.where).toBe("email LIKE ?");
      expect(result.params).toEqual(["%@example.com"]);
    });
  });

  describe("comparison operators", () => {
    it("should parse greater than (gt)", () => {
      const result = parseFilter("meta.created gt 1000", "User");
      expect(result.where).toBe("createdAt > ?");
      expect(result.params).toEqual([1000]);
    });

    it("should parse greater than or equal (ge)", () => {
      const result = parseFilter("meta.created ge 1000", "User");
      expect(result.where).toBe("createdAt >= ?");
      expect(result.params).toEqual([1000]);
    });

    it("should parse less than (lt)", () => {
      const result = parseFilter("meta.created lt 2000", "User");
      expect(result.where).toBe("createdAt < ?");
      expect(result.params).toEqual([2000]);
    });

    it("should parse less than or equal (le)", () => {
      const result = parseFilter("meta.created le 2000", "User");
      expect(result.where).toBe("createdAt <= ?");
      expect(result.params).toEqual([2000]);
    });
  });

  describe("present operator (pr)", () => {
    it("should parse present check", () => {
      const result = parseFilter("externalId pr", "User");
      expect(result.where).toBe("externalId IS NOT NULL");
      expect(result.params).toEqual([]);
    });
  });

  describe("logical operators", () => {
    it("should parse AND expressions", () => {
      const result = parseFilter('userName eq "john" and active eq true', "User");
      expect(result.where).toBe("(email = ? AND active = ?)");
      expect(result.params).toEqual(["john", 1]);
    });

    it("should parse OR expressions", () => {
      const result = parseFilter('userName eq "john" or userName eq "jane"', "User");
      expect(result.where).toBe("(email = ? OR email = ?)");
      expect(result.params).toEqual(["john", "jane"]);
    });

    it("should parse NOT expressions", () => {
      const result = parseFilter('not userName eq "admin"', "User");
      expect(result.where).toBe("NOT (email = ?)");
      expect(result.params).toEqual(["admin"]);
    });

    it("should parse complex expressions with parentheses", () => {
      const result = parseFilter(
        '(userName eq "john" or userName eq "jane") and active eq true',
        "User",
      );
      expect(result.where).toBe("(((email = ? OR email = ?)) AND active = ?)");
      expect(result.params).toEqual(["john", "jane", 1]);
    });

    it("should handle multiple AND operators", () => {
      const result = parseFilter('active eq true and userName sw "john" and externalId pr', "User");
      expect(result.where).toBe("((active = ? AND email LIKE ?) AND externalId IS NOT NULL)");
      expect(result.params).toEqual([1, "john%"]);
    });
  });

  describe("string escaping", () => {
    it("should handle escaped quotes in strings", () => {
      const result = parseFilter('displayName eq "John \\"Doe\\""', "User");
      expect(result.where).toBe("name = ?");
      expect(result.params).toEqual(['John "Doe"']);
    });

    it("should handle escaped backslashes", () => {
      const result = parseFilter('displayName eq "path\\\\name"', "User");
      expect(result.where).toBe("name = ?");
      expect(result.params).toEqual(["path\\name"]);
    });
  });

  describe("Group resource type", () => {
    it("should map displayName attribute for groups", () => {
      const result = parseFilter('displayName eq "Admins"', "Group");
      expect(result.where).toBe("displayName = ?");
      expect(result.params).toEqual(["Admins"]);
    });

    it("should map externalId attribute for groups", () => {
      const result = parseFilter('externalId eq "ext-123"', "Group");
      expect(result.where).toBe("externalId = ?");
      expect(result.params).toEqual(["ext-123"]);
    });

    it("should map meta.created for groups", () => {
      const result = parseFilter("meta.created gt 1000", "Group");
      expect(result.where).toBe("createdAt > ?");
      expect(result.params).toEqual([1000]);
    });
  });

  describe("error handling", () => {
    it("should throw for unknown attributes", () => {
      expect(() => parseFilter('unknownAttr eq "value"', "User")).toThrow("Unknown attribute");
    });
  });

  describe("SCIM attribute mapping", () => {
    it("should map emails.value to email", () => {
      const result = parseFilter('emails.value eq "test@example.com"', "User");
      expect(result.where).toBe("email = ?");
      expect(result.params).toEqual(["test@example.com"]);
    });

    it("should map name.formatted to name", () => {
      const result = parseFilter('name.formatted eq "John Doe"', "User");
      expect(result.where).toBe("name = ?");
      expect(result.params).toEqual(["John Doe"]);
    });

    it("should map name.givenName to name", () => {
      const result = parseFilter('name.givenName co "John"', "User");
      expect(result.where).toBe("name LIKE ?");
      expect(result.params).toEqual(["%John%"]);
    });

    it("should map meta.lastModified to updatedAt", () => {
      const result = parseFilter('meta.lastModified gt "2024-01-01"', "User");
      expect(result.where).toBe("updatedAt > ?");
      expect(result.params).toEqual(["2024-01-01"]);
    });
  });
});

describe("buildListQuery", () => {
  describe("basic queries", () => {
    it("should build query with default options", () => {
      const result = buildListQuery("user", "User", {});

      expect(result.sql).toContain("SELECT * FROM user");
      expect(result.sql).toContain("WHERE 1=1");
      expect(result.sql).toContain("ORDER BY id ASC");
      expect(result.sql).toContain("LIMIT ?");
      expect(result.sql).toContain("OFFSET ?");
      expect(result.params).toEqual([100, 0]); // default count=100, startIndex=1 -> offset=0
    });

    it("should build count query", () => {
      const result = buildListQuery("user", "User", {});

      expect(result.countSql).toBe("SELECT COUNT(*) as total FROM user WHERE 1=1");
      expect(result.countParams).toEqual([]);
    });
  });

  describe("pagination", () => {
    it("should handle custom startIndex", () => {
      const result = buildListQuery("user", "User", { startIndex: 11 });

      // startIndex=11 means offset=10 (0-indexed)
      expect(result.params[1]).toBe(10);
    });

    it("should handle custom count", () => {
      const result = buildListQuery("user", "User", { count: 25 });

      expect(result.params[0]).toBe(25);
    });

    it("should handle startIndex of 0", () => {
      const result = buildListQuery("user", "User", { startIndex: 0 });

      // startIndex=0 should result in offset=0 (not negative)
      expect(result.params[1]).toBe(0);
    });

    it("should handle negative startIndex", () => {
      const result = buildListQuery("user", "User", { startIndex: -5 });

      // Negative startIndex should result in offset=0
      expect(result.params[1]).toBe(0);
    });
  });

  describe("sorting", () => {
    it("should sort by specified attribute", () => {
      const result = buildListQuery("user", "User", { sortBy: "userName" });

      expect(result.sql).toContain("ORDER BY email ASC");
    });

    it("should sort descending", () => {
      const result = buildListQuery("user", "User", {
        sortBy: "userName",
        sortOrder: "descending",
      });

      expect(result.sql).toContain("ORDER BY email DESC");
    });

    it("should default to id if sortBy attribute unknown", () => {
      const result = buildListQuery("user", "User", { sortBy: "unknownAttr" });

      expect(result.sql).toContain("ORDER BY id ASC");
    });
  });

  describe("filtering", () => {
    it("should include filter in query", () => {
      const result = buildListQuery("user", "User", {
        filter: "active eq true",
      });

      expect(result.sql).toContain("WHERE active = ?");
      // params = [1 (filter), 100 (limit), 0 (offset)]
      expect(result.params[0]).toBe(1);
    });

    it("should include filter params in count query", () => {
      const result = buildListQuery("user", "User", {
        filter: 'userName eq "test@example.com"',
      });

      expect(result.countSql).toContain("WHERE email = ?");
      expect(result.countParams).toEqual(["test@example.com"]);
    });

    it("should combine all options", () => {
      const result = buildListQuery("user", "User", {
        count: 50,
        filter: "active eq true",
        sortBy: "displayName",
        sortOrder: "descending",
        startIndex: 51,
      });

      expect(result.sql).toContain("WHERE active = ?");
      expect(result.sql).toContain("ORDER BY name DESC");
      expect(result.sql).toContain("LIMIT ?");
      expect(result.sql).toContain("OFFSET ?");
      // params = [1 (filter), 50 (limit), 50 (offset)]
      expect(result.params).toEqual([1, 50, 50]);
    });
  });

  describe("Group table", () => {
    it("should build query for groups table", () => {
      const result = buildListQuery("scim_group", "Group", {
        filter: 'displayName eq "Admins"',
        sortBy: "displayName",
      });

      expect(result.sql).toContain("SELECT * FROM scim_group");
      expect(result.sql).toContain("WHERE displayName = ?");
      expect(result.sql).toContain("ORDER BY displayName ASC");
      expect(result.params[0]).toBe("Admins");
    });
  });
});
