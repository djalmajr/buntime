import type * as React from "react";
import { Icon } from "./icon";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "./ui/sidebar";

interface NavMainSubItem {
  linkProps?: Record<string, unknown>;
  title: string;
  url: string;
}

export interface NavMainItem {
  icon?: React.ReactNode;
  isActive?: boolean;
  items?: NavMainSubItem[];
  linkProps?: Record<string, unknown>;
  title: string;
  url?: string;
}

export interface NavMainProps {
  items: NavMainItem[];
  label?: React.ReactNode;
  labelClassName?: string;
  LinkComponent?: React.ElementType;
}

export function NavMain({
  items,
  label,
  labelClassName = "text-[0.625rem] uppercase",
  LinkComponent = "a",
}: NavMainProps) {
  return (
    <SidebarGroup>
      {label && <SidebarGroupLabel className={labelClassName}>{label}</SidebarGroupLabel>}
      <SidebarMenu>
        {items.map((item) => {
          const hasSubItems = item.items && item.items.length > 0;

          if (hasSubItems) {
            return (
              <Collapsible
                asChild
                className="group/collapsible"
                defaultOpen={item.isActive}
                key={item.title}
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip={item.title}>
                      {item.icon}
                      <span>{item.title}</span>
                      <Icon
                        className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90"
                        icon="lucide:chevron-right"
                      />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {item.items!.map((subItem) => (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton asChild>
                            <LinkComponent
                              href={subItem.url}
                              to={subItem.url}
                              {...subItem.linkProps}
                            >
                              <span>{subItem.title}</span>
                            </LinkComponent>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            );
          }

          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild isActive={item.isActive} tooltip={item.title}>
                <LinkComponent href={item.url} to={item.url} {...item.linkProps}>
                  {item.icon}
                  <span>{item.title}</span>
                </LinkComponent>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
