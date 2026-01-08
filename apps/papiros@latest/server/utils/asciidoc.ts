import Asciidoctor from "asciidoctor";
import { readText } from "@/utils/s3";

const asciidoctor = Asciidoctor();

/**
 * Parse AsciiDoc attributes from a file in S3 (lightweight, header only)
 */
export async function parseFileAttributes(filePath: string): Promise<Record<string, string>> {
  const content = await readText(filePath);
  if (!content) return {};

  return parseAsciiDocAttributes(content);
}

/**
 * Parse AsciiDoc document attributes from content header
 * Only extracts attributes from the document header (before first == section)
 */
export function parseAsciiDocAttributes(content: string): Record<string, string> {
  const attributes: Record<string, string> = {};

  const lines = content.split("\n");

  for (const line of lines) {
    // Stop at first section heading (== ...)
    if (line.match(/^==\s+/)) {
      break;
    }

    // Extract document title (= Title)
    const titleMatch = line.match(/^=\s+(.+)$/);
    if (titleMatch) {
      attributes.title = titleMatch[1].trim();
      continue;
    }

    // Extract :attribute: value pairs
    const attrMatch = line.match(/^:([a-zA-Z-]+):\s*(.*)$/);
    if (attrMatch) {
      const [, name, value] = attrMatch;
      attributes[name] = value.trim();
    }
  }

  return attributes;
}

/**
 * Convert AsciiDoc content to HTML
 */
export function convertToHtml(content: string): string {
  try {
    // Remove :toc: attribute from content to prevent inline TOC generation
    const contentWithoutToc = content.replace(/^:toc:.*$/m, "");

    return asciidoctor.convert(contentWithoutToc, {
      safe: "safe",
      attributes: {
        showtitle: true,
      },
    }) as string;
  } catch (err) {
    console.error("Failed to convert AsciiDoc:", err);
    return "<p>Error rendering document</p>";
  }
}
