import { createRootRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "../components/ui/sidebar";
import { useTheme } from "../helpers/use-theme";

const navItems = [
  { icon: "lucide:layout-dashboard", path: "/", titleKey: "nav.dashboard" },
  { icon: "lucide:key", path: "/keys", titleKey: "nav.keys" },
  { icon: "lucide:list-todo", path: "/queue", titleKey: "nav.queue" },
  { icon: "lucide:search", path: "/search", titleKey: "nav.search" },
  { icon: "lucide:eye", path: "/watch", titleKey: "nav.watch" },
  { icon: "lucide:atom", path: "/atomic", titleKey: "nav.atomic" },
  { icon: "lucide:activity", path: "/metrics", titleKey: "nav.metrics" },
];

function AppSidebar() {
  const { t } = useTranslation("common");
  const router = useRouterState();
  const currentPath = router.location.pathname;
  const { effectiveTheme, toggleTheme } = useTheme();

  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-7 items-center justify-center rounded">
            <Icon className="size-4" icon="lucide:database" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">KeyVal Playground</span>
            <span className="truncate text-xs text-muted-foreground">Interactive SDK Testing</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[0.625rem] uppercase">
            {t("nav.features")}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  item.path === "/" ? currentPath === "/" : currentPath.startsWith(item.path);

                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={t(item.titleKey)}>
                      <Link to={item.path}>
                        <Icon className="size-4" icon={item.icon} />
                        <span>{t(item.titleKey)}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip={t("footer.toggleTheme")} onClick={toggleTheme}>
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <Icon
                  className="size-4"
                  icon={effectiveTheme === "dark" ? "lucide:sun" : "lucide:moon"}
                />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {effectiveTheme === "dark" ? t("footer.lightMode") : t("footer.darkMode")}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {t("footer.version", { version: "1.0.0" })}
                </span>
              </div>
              <Icon className="ml-auto size-4" icon="lucide:chevrons-up-down" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function RootLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
