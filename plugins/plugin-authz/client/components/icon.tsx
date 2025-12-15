import { Icon as IconifyIcon } from "@iconify-icon/react";
import type { SVGProps } from "react";

interface IconData {
  body: string;
  height: number;
  width: number;
}

type IconProps = SVGProps<SVGSVGElement> & {
  icon: IconData | string;
};

export function Icon({ className, icon, ...props }: IconProps) {
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

  // Use dynamic iconify-icon
  return <IconifyIcon className={className} icon={icon} />;
}

export type { IconData };
