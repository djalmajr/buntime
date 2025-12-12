import type * as React from "react";
import { Icon } from "~/components/icon";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "~/components/ui/sidebar";

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

export interface NavMainGroup {
  items: NavMainItem[];
  label?: string;
}

export interface NavMainProps {
  groups: NavMainGroup[];
  LinkComponent?: React.ElementType;
}

interface NavGroupProps {
  items: NavMainItem[];
  label?: string;
  LinkComponent: React.ElementType;
}

function NavGroup({ items, label, LinkComponent }: NavGroupProps) {
  return (
    <SidebarGroup>
      {label && (
        <SidebarGroupLabel className="text-[0.625rem] uppercase">{label}</SidebarGroupLabel>
      )}
      <SidebarMenu>
        {items.map((item) => {
          const hasSubItems = item.items && item.items.length > 0;
          const iconElement = typeof item.icon === "string" ? <Icon icon={item.icon} /> : item.icon;

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
                      {iconElement}
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
                  {iconElement}
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

export function NavMain({ groups, LinkComponent = "a" }: NavMainProps) {
  return (
    <div className="space-y-6">
      {groups.map((group, index) => {
        const navItems = group.items.map((item) => ({
          icon: item.icon ? (typeof item.icon === "string" ? item.icon : item.icon) : undefined,
          isActive: item.isActive,
          items: item.items?.map((subItem) => ({
            linkProps: {
              activeOptions: { exact: true },
              activeProps: { "data-active": "true" },
              inactiveProps: { "data-active": "false" },
            },
            title: subItem.title,
            url: subItem.url,
          })),
          linkProps: {
            activeOptions: { exact: item.url === "/" },
            activeProps: { "data-active": "true" },
            inactiveProps: { "data-active": "false" },
          },
          title: item.title,
          url: item.url,
        }));

        return (
          <NavGroup
            items={navItems}
            key={group.label ?? index}
            label={group.label}
            LinkComponent={LinkComponent}
          />
        );
      })}
    </div>
  );
}
