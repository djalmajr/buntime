import type * as React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Icon } from "./ui/icon";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "./ui/sidebar";

export interface TeamSwitcherApp {
  description: string;
  icon: React.ReactNode;
  isActive?: boolean;
  name: string;
  url: string;
}

export interface TeamSwitcherProps {
  apps: TeamSwitcherApp[];
  chevronIcon?: React.ReactNode;
  label?: string;
}

export function TeamSwitcher({ apps, chevronIcon, label = "Apps" }: TeamSwitcherProps) {
  const { isMobile } = useSidebar();
  const activeApp = apps.find((app) => app.isActive) ?? apps[0];

  if (!activeApp) {
    return null;
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              size="lg"
            >
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                {activeApp.icon}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{activeApp.name}</span>
                <span className="truncate text-xs">{activeApp.description}</span>
              </div>
              {chevronIcon ?? <Icon className="ml-auto" icon="lucide:chevrons-up-down" />}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">{label}</DropdownMenuLabel>
            {apps.map((app, index) => (
              <DropdownMenuItem asChild className="gap-2 p-2" key={app.name}>
                <a href={app.url}>
                  <div className="flex size-6 items-center justify-center rounded-md border">
                    {app.icon}
                  </div>
                  {app.name}
                  <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
                </a>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
