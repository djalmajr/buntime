# Function Parameters Rule

**RULE: Functions with more than 3 parameters MUST receive an object**

This simplifies maintenance, improves readability, and makes refactoring easier.

## Why

- Named parameters are self-documenting
- Order doesn't matter when calling
- Adding/removing parameters doesn't break existing calls
- Optional parameters are cleaner
- Easier to read at call sites

## Examples

```typescript
// OK - 3 parameters or fewer
function fetchData(url: string, method: string, timeout: number) {}

// WRONG - more than 3 parameters
function createUser(name: string, email: string, age: number, role: string) {}
createUser("John", "john@example.com", 30, "admin");

// CORRECT - use object
interface CreateUserParams {
  age: number;
  email: string;
  name: string;
  role: string;
}
function createUser({ age, email, name, role }: CreateUserParams) {}
createUser({ age: 30, email: "john@example.com", name: "John", role: "admin" });
```

## Exceptions

- 3 parameters or fewer are acceptable as positional
- Standard library patterns (e.g., `Array.map(callback, thisArg)`)
- Performance-critical hot paths where object allocation matters
