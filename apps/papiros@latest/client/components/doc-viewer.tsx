import { useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useProjectDoc, useProjectOverview } from "~/hooks/use-projects";
import { ReleaseTimeline } from "./release-timeline";
import { TocAside } from "./toc-aside";
import { Skeleton } from "./ui/skeleton";

interface DocViewerProps {
  file: string | null;
  project: string;
}

/**
 * Convert filename to slug (kebab-case)
 */
function toSlug(name: string): string {
  return name
    .replace(/\.adoc$/, "")
    .toLowerCase()
    .replace(/[._\s]+/g, "-")
    .replace(/[^a-z0-9-/]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Fix TOC anchor links to include the current path with basepath
 * Converts href="#section" to href="/basepath/project/file#section"
 */
function fixAnchorLinks(html: string, currentPath: string): string {
  return html.replace(/href="#([^"]+)"/g, `href="${currentPath}#$1"`);
}

/**
 * Convert relative .adoc links to app routes
 * Converts href="getting-started/installation.adoc" to href="/basepath/project/getting-started/installation"
 */
function fixDocLinks(html: string, basePath: string): string {
  return html.replace(
    /href="([^"#]+\.adoc)"/g,
    (_, path) => `href="${basePath}/${toSlug(path)}" data-doc-link="true"`,
  );
}

function DocSkeleton() {
  return (
    <div className="flex gap-8">
      <div className="flex-1 min-w-0 max-w-4xl space-y-6">
        <Skeleton className="h-10 w-3/4" />
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
        <Skeleton className="h-7 w-1/2 mt-8" />
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <Skeleton className="h-7 w-2/5 mt-8" />
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>
      <aside className="hidden lg:block w-56 shrink-0">
        <Skeleton className="h-5 w-24 mb-4" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-28 ml-3" />
          <Skeleton className="h-4 w-32 ml-3" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
      </aside>
    </div>
  );
}

export function DocViewer({ file, project }: DocViewerProps) {
  const { i18n, t } = useTranslation();
  const router = useRouter();
  const contentRef = useRef<HTMLDivElement>(null);
  const lang = i18n.language;

  const overview$ = useProjectOverview(project, lang);
  const doc$ = useProjectDoc(project, file ?? "", lang);

  const query$ = file === null ? overview$ : doc$;

  // Get timeline folder from response (configured via :timeline: front-matter)
  const timelineFolder = query$.data?.timelineFolder;

  // Build paths for link fixing (both need basepath since we use window.location for navigation)
  const basepath = router.basepath === "/" ? "" : router.basepath;
  const projectPath = `${basepath}/${project}`;
  const currentPath = file === null ? projectPath : `${basepath}/${project}/${file}`;

  // Process HTML to fix anchor links and doc links
  const processedHtml = useMemo(() => {
    if (!query$.data?.html) return null;
    let html = query$.data.html;
    html = fixAnchorLinks(html, currentPath);
    html = fixDocLinks(html, projectPath);
    return html;
  }, [query$.data?.html, currentPath, projectPath]);

  // Intercept clicks on doc links for SPA navigation
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest("a[data-doc-link]") as HTMLAnchorElement;
      if (!link) return;

      e.preventDefault();
      const href = link.getAttribute("href");
      if (href) {
        // Use history.push directly to avoid basepath duplication
        router.history.push(href);
      }
    };

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [router.history]);

  // Render mermaid diagrams after HTML is inserted
  useEffect(() => {
    const container = contentRef.current;
    if (!container || !processedHtml) return;

    const mermaidKeywords = [
      "graph ",
      "graph\n",
      "flowchart ",
      "flowchart\n",
      "sequenceDiagram",
      "classDiagram",
      "stateDiagram",
      "erDiagram",
      "journey",
      "gantt",
      "pie ",
      "pie\n",
      "mindmap",
      "timeline",
      "gitGraph",
    ];

    // Find all <pre> elements that contain mermaid syntax
    const preElements = container.querySelectorAll(".listingblock pre");
    let hasMermaid = false;

    preElements.forEach((pre, index) => {
      const content = pre.textContent?.trim() || "";
      const isMermaid = mermaidKeywords.some((keyword) => content.startsWith(keyword));

      if (isMermaid) {
        hasMermaid = true;
        // Create a wrapper div for mermaid
        const wrapper = document.createElement("div");
        wrapper.className = "mermaid";
        wrapper.textContent = content;
        wrapper.id = `mermaid-diagram-${index}`;

        // Replace the listingblock with the mermaid wrapper
        const listingBlock = pre.closest(".listingblock");
        if (listingBlock?.parentNode) {
          listingBlock.parentNode.replaceChild(wrapper, listingBlock);
        }
      }
    });

    // Run mermaid if there are diagrams (mermaid loaded via index.html)
    if (hasMermaid && window.mermaid) {
      window.mermaid.run({ querySelector: ".mermaid" });
    }
  }, [processedHtml]);

  if (query$.isPending) {
    return <DocSkeleton />;
  }

  if (query$.isError || query$.data?.error) {
    const errorMessage = query$.data?.error ?? query$.error?.message ?? "Unknown error";
    return (
      <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
        <h2 className="text-lg font-semibold text-destructive mb-2">{t("docLoadError")}</h2>
        <p className="text-destructive/80">{errorMessage}</p>
        <p className="text-sm text-destructive/60 mt-4">{t("docLoadErrorHint")}</p>
      </div>
    );
  }

  return (
    <div className="flex gap-8" ref={contentRef}>
      <article className="flex-1 min-w-0 max-w-4xl">
        {processedHtml && (
          <div className="adoc-content" dangerouslySetInnerHTML={{ __html: processedHtml }} />
        )}
        {timelineFolder && (
          <div className="mt-8">
            <ReleaseTimeline folder={timelineFolder} project={project} />
          </div>
        )}
      </article>
      {processedHtml && !timelineFolder && (
        <TocAside html={processedHtml} scrollContainerId="doc-scroll-container" />
      )}
    </div>
  );
}
