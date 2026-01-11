import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { render } from "ink-testing-library";
import AppList from "./app";

// Helper to create fetch mock with proper typing
function mockFetch(fn: () => Promise<Response>) {
  globalThis.fetch = mock(fn) as unknown as typeof fetch;
}

describe("AppList component", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockFetch(() => Promise.resolve(new Response("[]")));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("loading state", () => {
    it("should show loading spinner initially", () => {
      globalThis.fetch = mock(() => new Promise(() => {})) as unknown as typeof fetch;

      const { lastFrame } = render(<AppList options={{ url: "http://localhost:8000" }} />);

      expect(lastFrame()).toContain("Loading apps...");
    });
  });

  describe("success state", () => {
    it("should display apps when fetch succeeds", async () => {
      const apps = [
        {
          name: "todos-kv",
          path: "/data/apps/todos-kv/1.0.0",
          versions: ["1.0.0"],
        },
      ];

      mockFetch(() => Promise.resolve(new Response(JSON.stringify(apps))));

      const { lastFrame } = render(<AppList options={{ url: "http://localhost:8000" }} />);

      await new Promise((r) => setTimeout(r, 50));

      const output = lastFrame()!;
      expect(output).toContain("Installed Apps (1)");
      expect(output).toContain("todos-kv");
      expect(output).toContain("1.0.0");
      expect(output).toContain("/data/apps/todos-kv/1.0.0");
    });

    it("should display multiple apps", async () => {
      const apps = [
        {
          name: "todos-kv",
          path: "/data/apps/todos-kv/1.0.0",
          versions: ["1.0.0"],
        },
        {
          name: "hello-api",
          path: "/data/apps/hello-api/1.0.0",
          versions: ["1.0.0", "1.1.0"],
        },
      ];

      mockFetch(() => Promise.resolve(new Response(JSON.stringify(apps))));

      const { lastFrame } = render(<AppList options={{ url: "http://localhost:8000" }} />);

      await new Promise((r) => setTimeout(r, 50));

      const output = lastFrame()!;
      expect(output).toContain("Installed Apps (2)");
      expect(output).toContain("todos-kv");
      expect(output).toContain("hello-api");
      expect(output).toContain("1.0.0, 1.1.0");
    });
  });

  describe("empty state", () => {
    it("should show message when no apps are installed", async () => {
      mockFetch(() => Promise.resolve(new Response(JSON.stringify([]))));

      const { lastFrame } = render(<AppList options={{ url: "http://localhost:8000" }} />);

      await new Promise((r) => setTimeout(r, 50));

      const output = lastFrame()!;
      expect(output).toContain("No apps installed");
      expect(output).toContain("buntime app install");
    });
  });

  describe("error state", () => {
    it("should show error message when fetch fails", async () => {
      mockFetch(() => Promise.resolve(new Response("Not found", { status: 404 })));

      const { lastFrame } = render(<AppList options={{ url: "http://localhost:8000" }} />);

      await new Promise((r) => setTimeout(r, 50));

      const output = lastFrame()!;
      expect(output).toContain("Error:");
      expect(output).toContain("404");
    });

    it("should show connection error message", async () => {
      globalThis.fetch = mock(() =>
        Promise.reject(new Error("Connection refused")),
      ) as unknown as typeof fetch;

      const { lastFrame } = render(<AppList options={{ url: "http://localhost:8000" }} />);

      await new Promise((r) => setTimeout(r, 50));

      const output = lastFrame()!;
      expect(output).toContain("Error:");
      expect(output).toContain("Connection refused");
    });

    it("should show helpful message about server URL", async () => {
      globalThis.fetch = mock(() =>
        Promise.reject(new Error("Network error")),
      ) as unknown as typeof fetch;

      const { lastFrame } = render(<AppList options={{ url: "http://custom:9000" }} />);

      await new Promise((r) => setTimeout(r, 50));

      const output = lastFrame()!;
      expect(output).toContain("http://custom:9000");
    });
  });

  describe("API endpoint", () => {
    it("should call correct API endpoint with custom URL", async () => {
      let calledUrl = "";
      globalThis.fetch = mock((url: string) => {
        calledUrl = url;
        return Promise.resolve(new Response("[]"));
      }) as unknown as typeof fetch;

      render(<AppList options={{ url: "http://custom:9000" }} />);

      await new Promise((r) => setTimeout(r, 50));

      expect(calledUrl).toBe("http://custom:9000/api/core/apps");
    });
  });
});
