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
};

/**
 * Icon component that renders SVG icons from @iconify/json data.
 * Missing icons are handled silently - the plugin warns at build time.
 *
 * Note: dangerouslySetInnerHTML is safe here because icon data comes from
 * the trusted @iconify/json registry generated at build time.
 */
export function Icon({ icon, ...props }: IconProps) {
  const iconData = typeof icon === "string" ? registry[icon] : icon;

  if (!iconData) {
    return null;
  }

  return (
    <svg
      dangerouslySetInnerHTML={{ __html: iconData.body }}
      height="1em"
      viewBox={`0 0 ${iconData.width} ${iconData.height}`}
      width="1em"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    />
  );
}

export type { IconData };
