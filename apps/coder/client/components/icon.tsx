import { registry } from "virtual:icons";
import type { SVGProps } from "react";

interface IconData {
  body: string;
  height: number;
  width: number;
}

type IconProps = SVGProps<SVGSVGElement> &
  (
    | {
        icon: IconData;
        name?: never;
      }
    | {
        icon?: never;
        /** Icon name in format "collection:icon" (e.g. "lucide:search") */
        name: string;
      }
  );

/**
 * Icon component that renders SVG icons from @iconify/json data.
 *
 * Usage:
 * - Static: <Icon name="lucide:search" className="size-4" />
 * - Dynamic: <Icon name={dynamicIconName} className="size-4" />
 *
 * All icon names are resolved from the virtual:icons registry at build-time.
 */
export function Icon({ icon, name, ...props }: IconProps) {
  // If icon prop is provided, use it directly
  // If name is provided, look up from registry
  const iconData = icon ?? (name ? registry[name] : undefined);

  if (!iconData) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`Icon: "${name}" not found. Ensure it's used somewhere with a static string.`);
    }
    return null;
  }

  // Detect if this is a stroke-based icon (lucide) or a fill-based icon (flags, etc.)
  const isStrokeIcon = name?.startsWith("lucide:");

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

  return (
    <svg
      {...svgProps}
      dangerouslySetInnerHTML={{ __html: iconData.body }}
      {...props}
    />
  );
}

export type { IconData };
