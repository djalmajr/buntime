import { registry } from "virtual:icons";
import { Icon as IconifyIcon } from "@iconify-icon/react";
import type { SVGProps } from "react";

interface IconData {
  body: string;
  height: number;
  width: number;
}

type IconProps = SVGProps<SVGSVGElement> & {
  /** Icon name in format "collection:icon" (e.g. "lucide:search") or IconData object */
  icon: string | IconData;
};

/**
 * Icon component that renders SVG icons.
 *
 * - Uses static registry from virtual:icons when available (build-time collected)
 * - Falls back to @iconify-icon/react for dynamic icons from plugins
 */
export function Icon({ icon, className, ...props }: IconProps) {
  // If icon is an IconData object, render directly
  if (typeof icon !== "string") {
    return (
      <svg
        aria-hidden="true"
        className={className}
        height="1em"
        viewBox={`0 0 ${icon.width} ${icon.height}`}
        width="1em"
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <g dangerouslySetInnerHTML={{ __html: icon.body }} />
      </svg>
    );
  }

  // Check static registry first (build-time collected icons)
  const iconData = registry[icon];

  if (iconData) {
    return (
      <svg
        aria-hidden="true"
        className={className}
        height="1em"
        viewBox={`0 0 ${iconData.width} ${iconData.height}`}
        width="1em"
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <g dangerouslySetInnerHTML={{ __html: iconData.body }} />
      </svg>
    );
  }

  // Fallback to dynamic iconify-icon for plugin icons not in registry
  return <IconifyIcon className={className} icon={icon} />;
}

export type { IconData };
