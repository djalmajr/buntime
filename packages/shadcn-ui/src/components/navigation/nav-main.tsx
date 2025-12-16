import type * as React from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Icon } from "../ui/icon";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "../ui/sidebar";

interface NavMainSubItem {
  title: string;
  url: string;
}

export interface NavMainItem {
  icon?: React.ReactNode;
  isActive?: boolean;
  items?: NavMainSubItem[];
  linkProps?: Record<string, unknown>;
  title: string;
  url: string;
}

export interface NavMainProps {
  chevronIcon?: React.ReactNode;
  items: NavMainItem[];
  label?: React.ReactNode;
  labelClassName?: string;
  LinkComponent?: React.ElementType;
}

export function NavMain({
  chevronIcon,
  items,
  label,
  labelClassName,
  LinkComponent = "a",
}: NavMainProps) {
  return (
    <SidebarGroup>
      {label && <SidebarGroupLabel className={labelClassName}>{label}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const hasSubItems = item.items && item.items.length > 0;

            if (hasSubItems) {
              return (
                <Collapsible asChild defaultOpen={item.isActive} key={item.title}>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={item.isActive} tooltip={item.title}>
                      <LinkComponent href={item.url} to={item.url} {...item.linkProps}>
                        {item.icon}
                        <span>{item.title}</span>
                      </LinkComponent>
                    </SidebarMenuButton>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuAction className="data-[state=open]:rotate-90">
                        {chevronIcon ?? <Icon icon="lucide:chevron-right" />}
                        <span className="sr-only">Toggle</span>
                      </SidebarMenuAction>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {item.items!.map((subItem) => (
                          <SidebarMenuSubItem key={subItem.title}>
                            <SidebarMenuSubButton asChild>
                              <LinkComponent href={subItem.url} to={subItem.url}>
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
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
