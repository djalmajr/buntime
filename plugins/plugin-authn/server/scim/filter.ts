/**
 * SCIM Filter Parser
 *
 * Parses SCIM filter expressions (RFC 7644 Section 3.4.2.2) and converts them to SQL.
 *
 * Supported operators:
 * - eq: equal
 * - ne: not equal
 * - co: contains
 * - sw: starts with
 * - ew: ends with
 * - gt: greater than
 * - ge: greater than or equal
 * - lt: less than
 * - le: less than or equal
 * - pr: present (has value)
 *
 * Supported logical operators:
 * - and
 * - or
 * - not
 *
 * Examples:
 * - userName eq "john@example.com"
 * - active eq true
 * - name.familyName co "Silva"
 * - externalId pr
 * - (userName eq "john") and (active eq true)
 */

/**
 * SCIM attribute to database column mapping for Users
 */
const USER_ATTRIBUTE_MAP: Record<string, string> = {
  active: "active",
  displayName: "name",
  "emails.value": "email",
  externalId: "externalId",
  id: "id",
  "meta.created": "createdAt",
  "meta.lastModified": "updatedAt",
  "name.familyName": "name",
  "name.formatted": "name",
  "name.givenName": "name",
  userName: "email",
};

/**
 * SCIM attribute to database column mapping for Groups
 */
const GROUP_ATTRIBUTE_MAP: Record<string, string> = {
  displayName: "displayName",
  externalId: "externalId",
  id: "id",
  "meta.created": "createdAt",
  "meta.lastModified": "updatedAt",
};

type ResourceType = "Group" | "User";

/**
 * Get attribute mapping for a resource type
 */
function getAttributeMap(resourceType: ResourceType): Record<string, string> {
  return resourceType === "User" ? USER_ATTRIBUTE_MAP : GROUP_ATTRIBUTE_MAP;
}

/**
 * Token types for the lexer
 */
type TokenType =
  | "AND"
  | "ATTRIBUTE"
  | "BOOLEAN"
  | "EOF"
  | "LPAREN"
  | "NOT"
  | "NULL"
  | "NUMBER"
  | "OPERATOR"
  | "OR"
  | "RPAREN"
  | "STRING";

interface Token {
  type: TokenType;
  value: string;
}

/**
 * Tokenize a SCIM filter expression
 */
function tokenize(filter: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < filter.length) {
    // Skip whitespace
    while (pos < filter.length && /\s/.test(filter[pos] ?? "")) {
      pos++;
    }

    if (pos >= filter.length) break;

    const char = filter[pos];

    // Parentheses
    if (char === "(") {
      tokens.push({ type: "LPAREN", value: "(" });
      pos++;
      continue;
    }

    if (char === ")") {
      tokens.push({ type: "RPAREN", value: ")" });
      pos++;
      continue;
    }

    // String literals
    if (char === '"') {
      pos++;
      let value = "";
      while (pos < filter.length && filter[pos] !== '"') {
        if (filter[pos] === "\\") {
          pos++;
          if (pos < filter.length) {
            value += filter[pos];
            pos++;
          }
        } else {
          value += filter[pos];
          pos++;
        }
      }
      pos++; // Skip closing quote
      tokens.push({ type: "STRING", value });
      continue;
    }

    // Identifiers, keywords, and operators
    let identifier = "";
    while (pos < filter.length && /[a-zA-Z0-9_.]/.test(filter[pos] ?? "")) {
      identifier += filter[pos];
      pos++;
    }

    if (identifier) {
      const lower = identifier.toLowerCase();

      // Logical operators
      if (lower === "and") {
        tokens.push({ type: "AND", value: "and" });
      } else if (lower === "or") {
        tokens.push({ type: "OR", value: "or" });
      } else if (lower === "not") {
        tokens.push({ type: "NOT", value: "not" });
      }
      // Boolean values
      else if (lower === "true" || lower === "false") {
        tokens.push({ type: "BOOLEAN", value: lower });
      }
      // Null
      else if (lower === "null") {
        tokens.push({ type: "NULL", value: "null" });
      }
      // Comparison operators
      else if (["co", "eq", "ew", "ge", "gt", "le", "lt", "ne", "pr", "sw"].includes(lower)) {
        tokens.push({ type: "OPERATOR", value: lower });
      }
      // Numbers
      else if (/^\d+(\.\d+)?$/.test(identifier)) {
        tokens.push({ type: "NUMBER", value: identifier });
      }
      // Attributes
      else {
        tokens.push({ type: "ATTRIBUTE", value: identifier });
      }
      continue;
    }

    // Unknown character - skip
    pos++;
  }

  tokens.push({ type: "EOF", value: "" });
  return tokens;
}

/**
 * Parse result containing SQL WHERE clause and parameters
 */
export interface ParseResult {
  params: unknown[];
  where: string;
}

/**
 * Parser for SCIM filter expressions
 */
class FilterParser {
  private attributeMap: Record<string, string>;
  private params: unknown[] = [];
  private pos = 0;
  private tokens: Token[];

  constructor(tokens: Token[], resourceType: ResourceType) {
    this.tokens = tokens;
    this.attributeMap = getAttributeMap(resourceType);
  }

  /**
   * Parse the filter expression
   */
  parse(): ParseResult {
    const where = this.parseExpression();
    return { where, params: this.params };
  }

  private current(): Token {
    return this.tokens[this.pos] ?? { type: "EOF", value: "" };
  }

  private advance(): Token {
    const token = this.current();
    this.pos++;
    return token;
  }

  private parseExpression(): string {
    return this.parseOr();
  }

  private parseOr(): string {
    let left = this.parseAnd();

    while (this.current().type === "OR") {
      this.advance();
      const right = this.parseAnd();
      left = `(${left} OR ${right})`;
    }

    return left;
  }

  private parseAnd(): string {
    let left = this.parseNot();

    while (this.current().type === "AND") {
      this.advance();
      const right = this.parseNot();
      left = `(${left} AND ${right})`;
    }

    return left;
  }

  private parseNot(): string {
    if (this.current().type === "NOT") {
      this.advance();
      const expr = this.parsePrimary();
      return `NOT (${expr})`;
    }

    return this.parsePrimary();
  }

  private parsePrimary(): string {
    // Parenthesized expression
    if (this.current().type === "LPAREN") {
      this.advance();
      const expr = this.parseExpression();
      if (this.current().type === "RPAREN") {
        this.advance();
      }
      return `(${expr})`;
    }

    // Attribute comparison
    return this.parseComparison();
  }

  private parseComparison(): string {
    const attrToken = this.advance();
    if (attrToken.type !== "ATTRIBUTE") {
      throw new Error(`Expected attribute, got ${attrToken.type}`);
    }

    const attribute = attrToken.value;
    const column = this.attributeMap[attribute];

    if (!column) {
      throw new Error(`Unknown attribute: ${attribute}`);
    }

    const opToken = this.advance();
    if (opToken.type !== "OPERATOR") {
      throw new Error(`Expected operator, got ${opToken.type}`);
    }

    const operator = opToken.value;

    // Handle "pr" (present) operator - no value needed
    if (operator === "pr") {
      return `${column} IS NOT NULL`;
    }

    // Get the value
    const valueToken = this.advance();
    let value: unknown;

    switch (valueToken.type) {
      case "STRING":
        value = valueToken.value;
        break;
      case "NUMBER":
        value = Number.parseFloat(valueToken.value);
        break;
      case "BOOLEAN":
        value = valueToken.value === "true" ? 1 : 0;
        break;
      case "NULL":
        value = null;
        break;
      default:
        throw new Error(`Expected value, got ${valueToken.type}`);
    }

    // Generate SQL based on operator
    switch (operator) {
      case "eq":
        if (value === null) {
          return `${column} IS NULL`;
        }
        this.params.push(value);
        return `${column} = ?`;

      case "ne":
        if (value === null) {
          return `${column} IS NOT NULL`;
        }
        this.params.push(value);
        return `${column} != ?`;

      case "co":
        this.params.push(`%${value}%`);
        return `${column} LIKE ?`;

      case "sw":
        this.params.push(`${value}%`);
        return `${column} LIKE ?`;

      case "ew":
        this.params.push(`%${value}`);
        return `${column} LIKE ?`;

      case "gt":
        this.params.push(value);
        return `${column} > ?`;

      case "ge":
        this.params.push(value);
        return `${column} >= ?`;

      case "lt":
        this.params.push(value);
        return `${column} < ?`;

      case "le":
        this.params.push(value);
        return `${column} <= ?`;

      default:
        throw new Error(`Unknown operator: ${operator}`);
    }
  }
}

/**
 * Parse a SCIM filter expression and return SQL WHERE clause with parameters
 *
 * @param filter - SCIM filter expression
 * @param resourceType - Resource type (User or Group)
 * @returns Object with `where` clause and `params` array
 *
 * @example
 * ```typescript
 * const result = parseFilter('userName eq "john@example.com"', 'User');
 * // result = { where: 'email = ?', params: ['john@example.com'] }
 *
 * const result2 = parseFilter('active eq true and name.familyName co "Silva"', 'User');
 * // result2 = { where: '(active = ? AND name LIKE ?)', params: [1, '%Silva%'] }
 * ```
 */
export function parseFilter(filter: string, resourceType: ResourceType): ParseResult {
  if (!filter || filter.trim() === "") {
    return { where: "1=1", params: [] };
  }

  const tokens = tokenize(filter);
  const parser = new FilterParser(tokens, resourceType);
  return parser.parse();
}

/**
 * Build SQL query with optional filter, pagination, and sorting
 */
export interface QueryOptions {
  count?: number;
  filter?: string;
  sortBy?: string;
  sortOrder?: "ascending" | "descending";
  startIndex?: number;
}

/**
 * Build a complete SQL query for listing resources
 */
export function buildListQuery(
  table: string,
  resourceType: ResourceType,
  options: QueryOptions,
): { countParams: unknown[]; countSql: string; params: unknown[]; sql: string } {
  const { filter, startIndex = 1, count = 100, sortBy, sortOrder = "ascending" } = options;

  // Parse filter
  const { where, params } = parseFilter(filter ?? "", resourceType);

  // Get sort column
  const attributeMap = getAttributeMap(resourceType);
  const sortColumn = sortBy ? (attributeMap[sortBy] ?? "id") : "id";
  const sortDir = sortOrder === "descending" ? "DESC" : "ASC";

  // Build main query
  const offset = Math.max(0, startIndex - 1);
  const sql = `SELECT * FROM ${table} WHERE ${where} ORDER BY ${sortColumn} ${sortDir} LIMIT ? OFFSET ?`;
  const queryParams = [...params, count, offset];

  // Build count query
  const countSql = `SELECT COUNT(*) as total FROM ${table} WHERE ${where}`;

  return {
    sql,
    params: queryParams,
    countSql,
    countParams: params,
  };
}
