import { useEffect, useMemo, useState } from "react";
import { cn } from "../utils/cn";

interface TocItem {
  id: string;
  level: number;
  text: string;
}

interface TocAsideProps {
  className?: string;
  html: string;
  scrollContainerId?: string;
  title?: string;
}

/**
 * Extract headings (h2, h3) from HTML content
 */
function extractTocItems(html: string): TocItem[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const headings = doc.querySelectorAll("h2[id], h3[id]");

  return Array.from(headings).map((h) => ({
    id: h.id,
    level: parseInt(h.tagName[1]!, 10),
    text: h.textContent?.trim() || "",
  }));
}

/**
 * Scroll-spy hook using scroll events
 * Works with custom scroll containers
 */
function useTocScrollSpy(headingIds: string[], scrollContainerId?: string) {
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    if (headingIds.length === 0) return;

    const container = scrollContainerId ? document.getElementById(scrollContainerId) : null;

    if (!container) {
      // Fallback: set first as active
      setActiveId(headingIds[0] || "");
      return;
    }

    const handleScroll = () => {
      const scrollTop = container.scrollTop;
      const clientHeight = container.clientHeight;
      const scrollHeight = container.scrollHeight;
      const offset = 100; // Distance from top to consider "active"

      // Check if we're at the bottom of the container
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10;

      if (isAtBottom && headingIds.length > 0) {
        // At bottom: activate last heading
        setActiveId(headingIds[headingIds.length - 1] ?? "");
        return;
      }

      let currentActiveId = headingIds[0] || "";

      for (const id of headingIds) {
        const element = document.getElementById(id);
        if (element) {
          // Get element position relative to scroll container
          const elementTop = element.offsetTop;

          // If element is above the threshold, it's the current section
          if (scrollTop >= elementTop - offset) {
            currentActiveId = id;
          }
        }
      }

      setActiveId(currentActiveId);
    };

    container.addEventListener("scroll", handleScroll);
    handleScroll(); // Initial call

    return () => container.removeEventListener("scroll", handleScroll);
  }, [headingIds, scrollContainerId]);

  return activeId;
}

function TocAside({ className, html, scrollContainerId, title = "On this page" }: TocAsideProps) {
  const items = useMemo(() => extractTocItems(html), [html]);
  const headingIds = useMemo(() => items.map((item) => item.id), [items]);
  const activeId = useTocScrollSpy(headingIds, scrollContainerId);

  if (items.length === 0) {
    return null;
  }

  const handleClick = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const element = document.getElementById(id);
    const container = scrollContainerId ? document.getElementById(scrollContainerId) : null;

    if (element && container) {
      // Scroll within container
      container.scrollTo({
        top: element.offsetTop - 20,
        behavior: "smooth",
      });
      // Update URL using window.location.pathname to preserve encoding
      window.history.pushState(null, "", `${window.location.pathname}#${id}`);
    }
  };

  return (
    <aside className={cn("hidden lg:block w-56 shrink-0 border-l pl-4", className)}>
      <nav className="sticky top-0 pt-4">
        <h4 className="text-sm font-semibold mb-3 text-foreground">{title}</h4>
        <ul className="space-y-1 text-sm">
          {items.map((item) => {
            const isActive = activeId === item.id;
            return (
              <li key={item.id}>
                <a
                  className={cn(
                    "block py-1 transition-colors hover:text-foreground",
                    item.level === 3 && "pl-4",
                    isActive ? "text-primary font-medium" : "text-muted-foreground",
                  )}
                  href={`#${item.id}`}
                  onClick={(e) => handleClick(e, item.id)}
                >
                  {item.text}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

export { TocAside, type TocAsideProps, type TocItem };
