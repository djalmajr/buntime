import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { Table } from "./table";

describe("Table component", () => {
  describe("rendering", () => {
    it("should render empty data message", () => {
      const { lastFrame } = render(<Table data={[]} />);

      expect(lastFrame()).toContain("No data");
    });

    it("should render table with headers", () => {
      const data = [{ Name: "Plugin A", Version: "1.0.0" }];

      const { lastFrame } = render(<Table data={data} />);
      const output = lastFrame()!;

      expect(output).toContain("Name");
      expect(output).toContain("Version");
    });

    it("should render table rows", () => {
      const data = [
        { Name: "Plugin A", Version: "1.0.0" },
        { Name: "Plugin B", Version: "2.0.0" },
      ];

      const { lastFrame } = render(<Table data={data} />);
      const output = lastFrame()!;

      expect(output).toContain("Plugin A");
      expect(output).toContain("1.0.0");
      expect(output).toContain("Plugin B");
      expect(output).toContain("2.0.0");
    });

    it("should handle multiple columns", () => {
      const data = [{ Name: "App", Base: "/app", Versions: "1.0.0, 1.1.0" }];

      const { lastFrame } = render(<Table data={data} />);
      const output = lastFrame()!;

      expect(output).toContain("Name");
      expect(output).toContain("Base");
      expect(output).toContain("Versions");
      expect(output).toContain("App");
      expect(output).toContain("/app");
      expect(output).toContain("1.0.0, 1.1.0");
    });

    it("should render separator line", () => {
      const data = [{ Name: "Test" }];

      const { lastFrame } = render(<Table data={data} />);
      const output = lastFrame()!;

      // Should have dashes as separator
      expect(output).toContain("-");
    });
  });

  describe("column width calculation", () => {
    it("should align columns based on content width", () => {
      const data = [
        { Short: "A", LongerColumn: "Value" },
        { Short: "B", LongerColumn: "Another Value" },
      ];

      const { lastFrame } = render(<Table data={data} />);
      const output = lastFrame()!;

      // Both rows should be rendered
      expect(output).toContain("A");
      expect(output).toContain("B");
      expect(output).toContain("Value");
      expect(output).toContain("Another Value");
    });

    it("should handle long header names", () => {
      const data = [{ VeryLongHeaderName: "X" }];

      const { lastFrame } = render(<Table data={data} />);
      const output = lastFrame()!;

      expect(output).toContain("VeryLongHeaderName");
      expect(output).toContain("X");
    });
  });

  describe("edge cases", () => {
    it("should handle null/undefined values", () => {
      const data = [{ Name: "Test", Value: null as unknown as string }];

      const { lastFrame } = render(<Table data={data} />);

      // Should not throw
      expect(lastFrame()).toBeDefined();
    });

    it("should handle single row", () => {
      const data = [{ Column: "Single" }];

      const { lastFrame } = render(<Table data={data} />);
      const output = lastFrame()!;

      expect(output).toContain("Column");
      expect(output).toContain("Single");
    });

    it("should handle numeric values", () => {
      const data = [{ Name: "Test", Count: 42 as unknown as string }];

      const { lastFrame } = render(<Table data={data} />);
      const output = lastFrame()!;

      expect(output).toContain("42");
    });
  });
});
