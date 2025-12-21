import type { FileResponse, TreeNode } from "@/types";
import { convertToHtml, parseFileAttributes } from "@/utils/asciidoc";
import { exists, fileStat, listDir, readText } from "@/utils/s3";
import { buildSlugPath, extractNumericPrefix, formatName } from "@/utils/slug";

interface TreeNodeWithOrder extends TreeNode {
  order: number;
}

/**
 * Read file content from S3 and convert to HTML
 */
export async function readFileContent(filePath: string): Promise<FileResponse | null> {
  const content = await readText(filePath);

  if (!content) {
    return null;
  }

  const stats = await fileStat(filePath);

  return {
    html: convertToHtml(content),
    modifiedAt: stats.lastModified?.toISOString() ?? new Date().toISOString(),
    path: filePath,
  };
}

/**
 * Calculate order value for sorting
 * Priority: :order: attribute (highest) > numeric prefix > Infinity (alphabetical fallback)
 * Items with :order: come before items with numeric prefix
 */
function calculateOrder(orderAttr: string | undefined, name: string): number {
  // :order: attribute has highest priority (0-999)
  if (orderAttr) {
    const order = parseInt(orderAttr, 10);
    if (!isNaN(order)) return order;
  }

  // Numeric prefix has second priority (1000+)
  const prefixOrder = extractNumericPrefix(name);
  if (prefixOrder !== null) {
    return 1000 + prefixOrder;
  }

  // No explicit order, sort alphabetically at the end
  return Infinity;
}

/**
 * Build hierarchical tree from an S3 "directory"
 * For directories with index.adoc, adds an "Overview" item as first child
 * Reads :title:, :slug:, and :order: attributes from each file
 * Sorting: :order: > numeric prefix > directories first > alphabetical
 */
export async function buildHierarchicalTree(dir: string, basePath = ""): Promise<TreeNode[]> {
  const nodes: TreeNodeWithOrder[] = [];

  try {
    const entries = await listDir(dir);

    for (const entry of entries) {
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
      const defaultSlug = buildSlugPath(relativePath);

      if (entry.type === "directory") {
        const subDir = `${dir}/${entry.name}`;
        const children = await buildHierarchicalTree(subDir, relativePath);

        // Check if directory has index.adoc (overview)
        const indexPath = `${subDir}/index.adoc`;
        const hasOverview = await exists(indexPath);
        let dirOrder = calculateOrder(undefined, entry.name);

        // Add overview as first child if exists, and use its :order: for directory
        if (hasOverview) {
          const attrs = await parseFileAttributes(indexPath);

          // Use :order: from index.adoc for directory ordering
          if (attrs.order) {
            dirOrder = calculateOrder(attrs.order, entry.name);
          }

          children.unshift({
            name: attrs.title || "Overview",
            path: `${relativePath}/index.adoc`,
            slug: attrs.slug || `${defaultSlug}/index`,
            type: "file",
          });
        }

        // Only add directory if it has children
        if (children.length > 0) {
          nodes.push({
            children,
            name: formatName(entry.name),
            order: dirOrder,
            path: relativePath,
            slug: defaultSlug,
            type: "directory",
          });
        }
      } else if (entry.name.endsWith(".adoc") && entry.name !== "index.adoc") {
        const filePath = `${dir}/${entry.name}`;
        const attrs = await parseFileAttributes(filePath);

        // Use :slug: from front-matter or generate from path
        // If custom slug is provided, prepend parent path
        const fileSlug = attrs.slug
          ? basePath
            ? `${buildSlugPath(basePath)}/${attrs.slug}`
            : attrs.slug
          : defaultSlug;

        nodes.push({
          name: attrs.title || formatName(entry.name),
          order: calculateOrder(attrs.order, entry.name),
          path: relativePath,
          slug: fileSlug,
          type: "file",
        });
      }
    }

    // Sort: by order, then directories first, then alphabetically
    nodes.sort((a, b) => {
      // First by order
      if (a.order !== b.order) {
        return a.order - b.order;
      }
      // Then directories before files
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      // Finally alphabetically
      return a.name.localeCompare(b.name);
    });
  } catch {
    // Directory doesn't exist or can't be read
  }

  // Remove order property before returning (it's internal)
  return nodes.map(({ order, ...node }) => node);
}

/**
 * Build a map of slug → path from tree for fast lookup
 */
export function buildSlugMap(tree: TreeNode[]): Record<string, string> {
  const map: Record<string, string> = {};

  function traverse(nodes: TreeNode[]) {
    for (const node of nodes) {
      if (node.type === "file") {
        map[node.slug] = node.path;
      }
      if (node.children) {
        traverse(node.children);
      }
    }
  }

  traverse(tree);
  return map;
}
