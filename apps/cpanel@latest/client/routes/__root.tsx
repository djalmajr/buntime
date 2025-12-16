import { registry } from "virtual:icons";
import { Icon, IconProvider, Toaster, useBreadcrumbs } from "@buntime/shadcn-ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FragmentNavigationBridge } from "~/components/fragment-navigation-bridge";
import { MainLayout, type SidebarNavGroup } from "~/components/main-layout";
import { HeaderProvider, useHeader } from "~/contexts/header-context";
import i18n from "~/helpers/i18n";
import { queryClient } from "~/helpers/query-client";
import { type MenuItemInfo, usePlugins } from "~/hooks/use-plugins";

const userData = {
  avatar: "/avatars/default.jpg",
  email: "admin@buntime.dev",
  name: "Buntime Admin",
};

export const Route = createRootRoute({
  beforeLoad: () => ({ queryClient }),
  component: RootLayout,
});

function RootLayoutContent() {
  const { t } = useTranslation();
  const { header } = useHeader();
  const breadcrumbs = useBreadcrumbs({ i18n });
  const plugins$ = usePlugins();
  const location = useLocation();

  const apps = [
    {
      description: t("nav.appDescription"),
      icon: <Icon className="size-4" icon="lucide:terminal" />,
      isActive: true,
      name: t("nav.appName"),
      url: "/",
    },
  ];

  const navGroups: SidebarNavGroup[] = useMemo(() => {
    // Collect all menus from plugins and sort by priority
    const allMenus = (plugins$.data ?? [])
      .flatMap((plugin) => plugin.menus)
      .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));

    const currentPath = location.pathname;

    // Check if a path matches the current location (exact match for submenus)
    const isPathActive = (path: string) => {
      return currentPath === path;
    };

    // Check if current path is within a menu's scope (for parent expansion)
    const isPathInMenu = (path: string) => {
      return currentPath === path || currentPath.startsWith(`${path}/`);
    };

    // Convert MenuItemInfo to NavMainItem format
    const mapMenuItem = (menu: MenuItemInfo) => {
      const subItems = menu.items?.map((sub) => ({
        isActive: isPathActive(sub.path),
        title: sub.title.includes(":") ? t(sub.title) : sub.title,
        url: sub.path,
      }));

      // Parent is active if path matches directly OR if any subitem is active (to keep it expanded)
      const hasActiveSubitem = subItems?.some((sub) => sub.isActive) ?? false;
      const isActive = hasActiveSubitem || isPathInMenu(menu.path);

      return {
        icon: menu.icon,
        isActive,
        items: subItems,
        title: menu.title.includes(":") ? t(menu.title) : menu.title,
        url: menu.path,
      };
    };

    return [
      {
        items: allMenus.map(mapMenuItem),
        label: t("nav.platform"),
      },
    ];
  }, [location.pathname, plugins$.data, t]);

  return (
    <MainLayout
      apps={apps}
      breadcrumbs={breadcrumbs}
      groups={navGroups}
      header={header ?? undefined}
      LinkComponent={Link}
      user={userData}
    >
      <div className="flex flex-1 flex-col gap-4 overflow-auto">
        <Outlet />
      </div>
    </MainLayout>
  );
}

function RootLayout() {
  return (
    <IconProvider registry={registry}>
      <QueryClientProvider client={queryClient}>
        <HeaderProvider>
          <RootLayoutContent />
          <FragmentNavigationBridge />
          <Toaster />
        </HeaderProvider>
      </QueryClientProvider>
    </IconProvider>
  );
}
