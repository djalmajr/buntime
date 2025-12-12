import type * as React from "react";
import { SidebarMenu, SidebarMenuItem } from "~/components/ui/sidebar";

export interface AppInfoProps {
  description: string;
  icon: React.ReactNode;
  name: string;
}

export function AppInfo({ description, icon, name }: AppInfoProps) {
  return (
    <SidebarMenu>
      <SidebarMenuItem className="flex gap-3">
        <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
          {icon}
        </div>
        <div className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate font-medium">{name}</span>
          <span className="truncate text-xs">{description}</span>
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
