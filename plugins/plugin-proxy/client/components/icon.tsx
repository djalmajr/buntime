import { Icon as IconifyIcon } from "@iconify-icon/react";
import type { SVGProps } from "react";

interface IconData {
  body: string;
  height: number;
  width: number;
}

type IconProps = SVGProps<SVGSVGElement> & {
  icon: string | IconData;
};

export function Icon({ icon, className, ...props }: IconProps) {
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

  return <IconifyIcon className={className} icon={icon} />;
}

export type { IconData };
