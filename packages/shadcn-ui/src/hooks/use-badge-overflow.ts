import * as React from "react";

const badgeWidthCache = new Map<string, number>();

const DEFAULT_BADGE_GAP = 4; // gap-1 = 4px
const DEFAULT_CONTAINER_PADDING = 16; // px-2 = 8px * 2
const DEFAULT_OVERFLOW_BADGE_WIDTH = 40; // Approximate width of "+N" badge

interface MeasureBadgeWidthOptions {
  cacheKey: string;
  className?: string;
  iconSize?: number;
  label: string;
  maxWidth?: number;
}

function measureBadgeWidth(options: MeasureBadgeWidthOptions): number {
  const { cacheKey, className, iconSize, label, maxWidth } = options;

  const cached = badgeWidthCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const measureEl = document.createElement("div");
  measureEl.className = `inline-flex items-center rounded-md border px-1.5 text-xs font-semibold h-5 gap-1 shrink-0 absolute invisible pointer-events-none ${className ?? ""}`;
  measureEl.style.whiteSpace = "nowrap";

  if (iconSize) {
    const icon = document.createElement("span");
    icon.className = "shrink-0";
    icon.style.width = `${iconSize}px`;
    icon.style.height = `${iconSize}px`;
    measureEl.appendChild(icon);
  }

  if (maxWidth) {
    const text = document.createElement("span");
    text.className = "truncate";
    text.style.maxWidth = `${maxWidth}px`;
    text.textContent = label;
    measureEl.appendChild(text);
  } else {
    measureEl.textContent = label;
  }

  document.body.appendChild(measureEl);
  const width = measureEl.offsetWidth;
  document.body.removeChild(measureEl);

  badgeWidthCache.set(cacheKey, width);
  return width;
}

interface UseBadgeOverflowOptions<T> {
  badgeGap?: number;
  cacheKeyPrefix?: string;
  className?: string;
  containerPadding?: number;
  containerRef: React.RefObject<HTMLElement | null>;
  getLabel: (item: T) => string;
  iconSize?: number;
  items: T[];
  lineCount: number;
  maxWidth?: number;
  overflowBadgeWidth?: number;
}

interface UseBadgeOverflowResult<T> {
  containerWidth: number;
  hiddenCount: number;
  visibleItems: T[];
}

/**
 * Hook to calculate how many badges fit in a container and show "+N" for overflow.
 *
 * @example
 * const containerRef = useRef<HTMLDivElement>(null);
 * const { visibleItems, hiddenCount } = useBadgeOverflow({
 *   items: filters,
 *   getLabel: (f) => f.name,
 *   containerRef,
 *   lineCount: 1,
 * });
 *
 * // Renders: [Badge1] [Badge2] +3
 */
export function useBadgeOverflow<T>(
  options: UseBadgeOverflowOptions<T>,
): UseBadgeOverflowResult<T> {
  const {
    badgeGap = DEFAULT_BADGE_GAP,
    cacheKeyPrefix = "",
    className,
    containerPadding = DEFAULT_CONTAINER_PADDING,
    containerRef,
    getLabel,
    iconSize,
    items,
    lineCount,
    maxWidth,
    overflowBadgeWidth = DEFAULT_OVERFLOW_BADGE_WIDTH,
  } = options;

  const [containerWidth, setContainerWidth] = React.useState(0);

  React.useEffect(() => {
    if (!containerRef.current) return;

    function measureWidth() {
      if (containerRef.current) {
        const width = containerRef.current.clientWidth - containerPadding;
        setContainerWidth(width);
      }
    }

    measureWidth();

    const resizeObserver = new ResizeObserver(measureWidth);
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [containerRef, containerPadding]);

  const result = React.useMemo(() => {
    if (!containerWidth || items.length === 0) {
      return { containerWidth, hiddenCount: 0, visibleItems: items };
    }

    let currentLine = 1;
    let currentLineWidth = 0;
    const visible: T[] = [];

    for (const item of items) {
      const label = getLabel(item);
      const cacheKey = cacheKeyPrefix ? `${cacheKeyPrefix}:${label}` : label;
      const badgeWidth = measureBadgeWidth({
        cacheKey,
        className,
        iconSize,
        label,
        maxWidth,
      });
      const widthWithGap = badgeWidth + badgeGap;

      if (currentLineWidth + widthWithGap <= containerWidth) {
        currentLineWidth += widthWithGap;
        visible.push(item);
      } else if (currentLine < lineCount) {
        currentLine++;
        currentLineWidth = widthWithGap;
        visible.push(item);
      } else {
        if (currentLineWidth + overflowBadgeWidth > containerWidth && visible.length > 0) {
          visible.pop();
        }
        break;
      }
    }

    return {
      containerWidth,
      hiddenCount: Math.max(0, items.length - visible.length),
      visibleItems: visible,
    };
  }, [
    badgeGap,
    cacheKeyPrefix,
    className,
    containerWidth,
    getLabel,
    iconSize,
    items,
    lineCount,
    maxWidth,
    overflowBadgeWidth,
  ]);

  return result;
}

/**
 * Clear the badge width cache. Useful when badge styles change.
 */
export function clearBadgeWidthCache(): void {
  badgeWidthCache.clear();
}
