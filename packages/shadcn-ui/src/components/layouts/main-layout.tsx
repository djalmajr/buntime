import type * as React from "react";
import { cn } from "../../utils/cn";
import { AppInfo } from "../app-info";
import { NavMain } from "../navigation/nav-main";
import { NavUser, type NavUserProps } from "../navigation/nav-user";
import { TeamSwitcher, type TeamSwitcherApp } from "../team-switcher";
import {
  Breadcrumb,
  BreadcrumbItem as BreadcrumbItemUI,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../ui/breadcrumb";
import { Icon } from "../ui/icon";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "../ui/sidebar";
import { Toaster } from "../ui/sonner";
import { LanguageSwitcher } from "../user-menu";

export interface MainLayoutBreadcrumb {
  href?: string;
  label: string;
}

export interface MainLayoutHeaderAction {
  href?: string;
  label: string;
  onClick?: () => void;
}

export interface MainLayoutHeader {
  actions?: React.ReactNode;
  description?: string;
  title?: React.ReactNode;
}

export interface SidebarNavItem {
  icon?: string;
  items?: { title: string; url: string }[];
  title: string;
  url: string;
}

export interface SidebarNavGroup {
  items: SidebarNavItem[];
  label?: string;
}

export interface MainLayoutProps {
  apps: TeamSwitcherApp[];
  appsLabel?: string;
  breadcrumbs?: MainLayoutBreadcrumb[];
  children: React.ReactNode;
  contentClassName?: string;
  customHeader?: React.ReactNode;
  enableSwitcher?: boolean;
  groups: SidebarNavGroup[];
  groupsLabelClassName?: string;
  header?: MainLayoutHeader;
  LinkComponent?: React.ComponentType<{ children: React.ReactNode; to: string }>;
  user: NavUserProps["user"];
}

interface DefaultHeaderProps {
  actions?: React.ReactNode;
  breadcrumbs?: MainLayoutBreadcrumb[];
  description?: string;
  LinkComponent?: React.ComponentType<{ children: React.ReactNode; to: string }>;
  title?: React.ReactNode;
}

function DefaultHeader({
  actions,
  breadcrumbs,
  description,
  LinkComponent,
  title,
}: DefaultHeaderProps) {
  return (
    <header className="border-b px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          {breadcrumbs && breadcrumbs.length > 0 && (
            <Breadcrumb>
              <BreadcrumbList>
                {breadcrumbs.map((bc, index) => {
                  const isLast = index === breadcrumbs.length - 1;

                  return (
                    <span className="contents" key={bc.href ?? bc.label}>
                      <BreadcrumbItemUI>
                        {isLast ? (
                          <BreadcrumbPage>{bc.label}</BreadcrumbPage>
                        ) : bc.href && LinkComponent ? (
                          <BreadcrumbLink asChild>
                            <LinkComponent to={bc.href}>{bc.label}</LinkComponent>
                          </BreadcrumbLink>
                        ) : (
                          <BreadcrumbPage>{bc.label}</BreadcrumbPage>
                        )}
                      </BreadcrumbItemUI>
                      {!isLast && <BreadcrumbSeparator />}
                    </span>
                  );
                })}
              </BreadcrumbList>
            </Breadcrumb>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {(title || description) && (
        <div className="mt-3 pl-7">
          {title && (
            <div className="flex items-center gap-2 text-lg font-semibold leading-none">
              {title}
            </div>
          )}
          {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
        </div>
      )}
    </header>
  );
}

interface SidebarNavContentProps {
  groups: SidebarNavGroup[];
  labelClassName?: string;
  LinkComponent?: React.ElementType;
}

function SidebarNavContent({
  groups,
  labelClassName = "text-[0.625rem] uppercase",
  LinkComponent,
}: SidebarNavContentProps) {
  return (
    <div className="space-y-6">
      {groups.map((group, index) => {
        const navItems = group.items.map((item) => ({
          icon: item.icon ? <Icon icon={item.icon} /> : undefined,
          items: item.items,
          linkProps: {
            activeOptions: { exact: item.url === "/" },
            activeProps: { "data-active": "true" },
            inactiveProps: { "data-active": "false" },
          },
          title: item.title,
          url: item.url,
        }));

        return (
          <NavMain
            items={navItems}
            key={group.label ?? index}
            label={group.label}
            labelClassName={labelClassName}
            LinkComponent={LinkComponent}
          />
        );
      })}
    </div>
  );
}

export function MainLayout({
  apps,
  appsLabel,
  breadcrumbs,
  children,
  contentClassName,
  customHeader,
  enableSwitcher = false,
  groups,
  groupsLabelClassName,
  header,
  LinkComponent,
  user,
}: MainLayoutProps) {
  const activeApp = apps.find((app) => app.isActive) ?? apps[0];

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full overflow-hidden">
        <Sidebar collapsible="offcanvas">
          <SidebarHeader>
            {enableSwitcher ? (
              <TeamSwitcher apps={apps} label={appsLabel} />
            ) : activeApp ? (
              <AppInfo
                description={activeApp.description}
                icon={activeApp.icon}
                name={activeApp.name}
              />
            ) : null}
          </SidebarHeader>
          <SidebarContent className="pt-3 pb-0">
            <SidebarNavContent
              groups={groups}
              labelClassName={groupsLabelClassName}
              LinkComponent={LinkComponent}
            />
          </SidebarContent>
          <SidebarFooter>
            <NavUser user={user}>
              <LanguageSwitcher />
            </NavUser>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset className="flex flex-col overflow-hidden">
          {customHeader ?? (
            <DefaultHeader
              actions={header?.actions}
              breadcrumbs={breadcrumbs}
              description={header?.description}
              LinkComponent={LinkComponent}
              title={header?.title}
            />
          )}
          <div className={cn("flex flex-1 flex-col overflow-hidden", contentClassName)}>
            {children}
          </div>
        </SidebarInset>
      </div>
      <Toaster />
    </SidebarProvider>
  );
}
