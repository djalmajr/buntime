import { registry } from "virtual:icons";
import type { SVGProps } from "react";

interface IconData {
  body: string;
  height: number;
  width: number;
}

type IconProps = SVGProps<SVGSVGElement> & {
  /** Icon name in format "collection:icon" (e.g. "lucide:search") or IconData object */
  icon: string | IconData;
  name?: never;
};

/**
 * Icon component that renders SVG icons from @iconify/json data.
 *
 * Usage:
 * - Static: <Icon icon="lucide:search" className="size-4" />
 * - Dynamic: <Icon icon={dynamicIconName} className="size-4" />
 *
 * All icon names are resolved from the virtual:icons registry at build-time.
 */
export function Icon({ icon, ...props }: IconProps) {
  // If icon is a string, look up from registry; otherwise use directly
  const iconName = typeof icon === "string" ? icon : undefined;
  const iconData = typeof icon === "string" ? registry[icon] : icon;

  if (!iconData) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `Icon: "${iconName}" not found. Ensure it's used somewhere with a static string.`,
      );
    }
    return null;
  }

  // Detect if this is a stroke-based icon (lucide) or a fill-based icon (flags, etc.)
  const isStrokeIcon = iconName?.startsWith("lucide:");

  // Base SVG props
  const svgProps = {
    height: "1em",
    viewBox: `0 0 ${iconData.width} ${iconData.height}`,
    width: "1em",
    xmlns: "http://www.w3.org/2000/svg",
    ...(isStrokeIcon && {
      fill: "none",
      stroke: "currentColor",
      strokeLinecap: "round" as const,
      strokeLinejoin: "round" as const,
      strokeWidth: 2,
    }),
  };

  return <svg {...svgProps} dangerouslySetInnerHTML={{ __html: iconData.body }} {...props} />;
}

export type { IconData };
