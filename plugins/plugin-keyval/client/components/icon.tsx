import { Icon as IconifyIcon } from "@iconify-icon/react";

interface IconProps {
  className?: string;
  icon: string;
}

export function Icon({ className, icon }: IconProps) {
  return <IconifyIcon className={className} icon={icon} />;
}
