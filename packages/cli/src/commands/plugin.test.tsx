import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { render } from "ink-testing-library";
import PluginList from "./plugin";

// Helper to create fetch mock with proper typing
function mockFetch(fn: () => Promise<Response>) {
  globalThis.fetch = mock(fn) as unknown as typeof fetch;
}

describe("PluginList component", () => {
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

      const { lastFrame } = render(<PluginList options={{ url: "http://localhost:8000" }} />);

      expect(lastFrame()).toContain("Loading plugins...");
    });
  });

  describe("success state", () => {
    it("should display plugins when fetch succeeds", async () => {
      const plugins = [
        {
          base: "/keyval",
          name: "@buntime/plugin-keyval",
          path: "/data/plugins/@buntime/plugin-keyval/1.0.0",
          versions: ["1.0.0"],
        },
      ];

      mockFetch(() => Promise.resolve(new Response(JSON.stringify(plugins))));

      const { lastFrame } = render(<PluginList options={{ url: "http://localhost:8000" }} />);

      // Wait for async state update
      await new Promise((r) => setTimeout(r, 50));

      const output = lastFrame()!;
      expect(output).toContain("Installed Plugins (1)");
      expect(output).toContain("@buntime/plugin-keyval");
      expect(output).toContain("/keyval");
      expect(output).toContain("1.0.0");
    });

    it("should display multiple plugins", async () => {
      const plugins = [
        {
          base: "/keyval",
          name: "@buntime/plugin-keyval",
          path: "/data/plugins/@buntime/plugin-keyval/1.0.0",
          versions: ["1.0.0"],
        },
        {
          base: "/metrics",
          name: "@buntime/plugin-metrics",
          path: "/data/plugins/@buntime/plugin-metrics/1.0.0",
          versions: ["1.0.0", "1.1.0"],
        },
      ];

      mockFetch(() => Promise.resolve(new Response(JSON.stringify(plugins))));

      const { lastFrame } = render(<PluginList options={{ url: "http://localhost:8000" }} />);

      await new Promise((r) => setTimeout(r, 50));

      const output = lastFrame()!;
      expect(output).toContain("Installed Plugins (2)");
      expect(output).toContain("@buntime/plugin-keyval");
      expect(output).toContain("@buntime/plugin-metrics");
      expect(output).toContain("1.0.0, 1.1.0");
    });

    it("should show dash for plugins without base path", async () => {
      const plugins = [
        {
          name: "@buntime/plugin-test",
          path: "/data/plugins/@buntime/plugin-test/1.0.0",
          versions: ["1.0.0"],
        },
      ];

      mockFetch(() => Promise.resolve(new Response(JSON.stringify(plugins))));

      const { lastFrame } = render(<PluginList options={{ url: "http://localhost:8000" }} />);

      await new Promise((r) => setTimeout(r, 50));

      const output = lastFrame()!;
      expect(output).toContain("-");
    });
  });

  describe("empty state", () => {
    it("should show message when no plugins are installed", async () => {
      mockFetch(() => Promise.resolve(new Response(JSON.stringify([]))));

      const { lastFrame } = render(<PluginList options={{ url: "http://localhost:8000" }} />);

      await new Promise((r) => setTimeout(r, 50));

      const output = lastFrame()!;
      expect(output).toContain("No plugins installed");
      expect(output).toContain("buntime plugin install");
    });
  });

  describe("error state", () => {
    it("should show error message when fetch fails", async () => {
      mockFetch(() => Promise.resolve(new Response("Not found", { status: 404 })));

      const { lastFrame } = render(<PluginList options={{ url: "http://localhost:8000" }} />);

      await new Promise((r) => setTimeout(r, 50));

      const output = lastFrame()!;
      expect(output).toContain("Error:");
      expect(output).toContain("404");
    });

    it("should show connection error message", async () => {
      globalThis.fetch = mock(() =>
        Promise.reject(new Error("Connection refused")),
      ) as unknown as typeof fetch;

      const { lastFrame } = render(<PluginList options={{ url: "http://localhost:8000" }} />);

      await new Promise((r) => setTimeout(r, 50));

      const output = lastFrame()!;
      expect(output).toContain("Error:");
      expect(output).toContain("Connection refused");
    });

    it("should show helpful message about server URL", async () => {
      globalThis.fetch = mock(() =>
        Promise.reject(new Error("Network error")),
      ) as unknown as typeof fetch;

      const { lastFrame } = render(<PluginList options={{ url: "http://custom:9000" }} />);

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

      render(<PluginList options={{ url: "http://custom:9000" }} />);

      await new Promise((r) => setTimeout(r, 50));

      expect(calledUrl).toBe("http://custom:9000/api/core/plugins");
    });
  });
});
