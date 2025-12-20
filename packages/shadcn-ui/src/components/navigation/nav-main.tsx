import type * as React from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Icon } from "../ui/icon";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "../ui/sidebar";

interface NavMainSubItem {
  isActive?: boolean;
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
            const hasActiveChild = hasSubItems && item.items!.some((sub) => sub.isActive);

            if (hasSubItems) {
              return (
                <Collapsible
                  asChild
                  className="group/collapsible"
                  defaultOpen={item.isActive || hasActiveChild}
                  key={item.title}
                >
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton hasActiveChild={hasActiveChild} tooltip={item.title}>
                        {item.icon}
                        <span>{item.title}</span>
                        <span className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90">
                          {chevronIcon ?? <Icon icon="lucide:chevron-right" />}
                        </span>
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {item.items!.map((subItem) => (
                          <SidebarMenuSubItem key={subItem.title}>
                            <SidebarMenuSubButton asChild isActive={subItem.isActive}>
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

            // Items without url and without sub-items are rendered as non-clickable
            if (!item.url) {
              return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton isActive={item.isActive} tooltip={item.title}>
                    {item.icon}
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
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
