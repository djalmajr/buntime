import {
  Breadcrumb,
  BreadcrumbItem as BreadcrumbItemUI,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  cn,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@buntime/shadcn-ui";
import type * as React from "react";
import { AppInfo } from "~/components/app-info";
import { Icon } from "~/components/icon";
import { NavMain } from "~/components/navigation/nav-main";

export interface MainLayoutBreadcrumb {
  href?: string;
  label: string;
}

export interface MainLayoutHeader {
  actions?: React.ReactNode;
  description?: string;
  title?: React.ReactNode;
}

export interface SidebarNavSubItem {
  isActive?: boolean;
  title: string;
  url: string;
}

export interface SidebarNavItem {
  icon?: string;
  isActive?: boolean;
  items?: SidebarNavSubItem[];
  title: string;
  url?: string;
}

export interface SidebarNavGroup {
  items: SidebarNavItem[];
  label?: string;
}

export interface MainLayoutApp {
  description: string;
  icon: React.ReactNode;
  isActive?: boolean;
  name: string;
  url: string;
}

export interface MainLayoutUser {
  avatar: string;
  email: string;
  name: string;
}

export interface MainLayoutProps {
  apps: MainLayoutApp[];
  breadcrumbs?: MainLayoutBreadcrumb[];
  children: React.ReactNode;
  contentClassName?: string;
  groups: SidebarNavGroup[];
  header?: MainLayoutHeader;
  LinkComponent?: React.ComponentType<{ children: React.ReactNode; to: string }>;
  user: MainLayoutUser;
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

interface NavUserProps {
  user: MainLayoutUser;
}

function NavUser({ user }: NavUserProps) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg">
          <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg text-xs font-medium">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{user.name}</span>
            <span className="truncate text-xs">{user.email}</span>
          </div>
          <Icon className="ml-auto size-4" icon="lucide:chevrons-up-down" />
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function MainLayout({
  apps,
  breadcrumbs,
  children,
  contentClassName,
  groups,
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
            {activeApp && (
              <AppInfo
                description={activeApp.description}
                icon={activeApp.icon}
                name={activeApp.name}
              />
            )}
          </SidebarHeader>
          <SidebarContent className="pt-3 pb-0">
            {groups.map((group, index) => (
              <NavMain
                items={group.items.map((item) => ({
                  ...item,
                  icon: item.icon ? <Icon icon={item.icon} /> : undefined,
                }))}
                key={group.label ?? index}
                label={group.label}
                LinkComponent={LinkComponent}
              />
            ))}
          </SidebarContent>
          <SidebarFooter>
            <NavUser user={user} />
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset className="flex flex-col overflow-hidden">
          <DefaultHeader
            actions={header?.actions}
            breadcrumbs={breadcrumbs}
            description={header?.description}
            LinkComponent={LinkComponent}
            title={header?.title}
          />
          <div className={cn("flex flex-1 flex-col overflow-hidden", contentClassName)}>
            {children}
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
