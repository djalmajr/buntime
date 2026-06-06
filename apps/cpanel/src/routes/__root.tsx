import { registry } from "virtual:icons";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ApiKeyLogin } from "~/components/auth/api-key-login";
import { LoadingSplash } from "~/components/auth/loading-splash";
import { MainLayout, type SidebarNavGroup, type SidebarNavItem } from "~/components/main-layout";
import { Icon, IconProvider } from "~/components/ui/icon";
import { Toaster } from "~/components/ui/sonner";
import { ApiKeyAuthProvider, useApiKey } from "~/contexts/api-key-auth-context";
import { HeaderProvider, useHeader } from "~/contexts/header-context";
import type { MenuItemInfo } from "~/helpers/api-client";
import i18n from "~/helpers/i18n";
import { queryClient } from "~/helpers/query-client";
import { useBreadcrumbs } from "~/hooks/use-breadcrumbs";
import { usePlugins } from "~/hooks/use-plugins";

export const Route = createRootRoute({
  component: RootLayout,
});

/**
 * Global auth gate. The cpanel authenticates end-to-end via X-API-Key against
 * the core runtime — runtime sections (overview / keys / apps / plugins) and
 * plugin UIs (mounted via `<z-frame>`) share the same session.
 */
function RootLayoutContent() {
  const { status } = useApiKey();

  if (status === "checking") return <LoadingSplash />;
  if (status !== "authenticated") return <ApiKeyLogin />;

  return <PlatformLayoutContent />;
}

function PlatformLayoutContent() {
  const { t } = useTranslation();
  const { can, logout } = useApiKey();
  const { header } = useHeader();
  const breadcrumbs = useBreadcrumbs({ i18n });
  const plugins$ = usePlugins();
  const location = useLocation();

  const apps = [
    {
      description: t("nav.appDescription"),
      icon: <Icon className="text-sidebar-primary size-6 shrink-0" icon="lucide:terminal" />,
      isActive: true,
      name: t("nav.appName"),
      url: "/",
    },
  ];

  const navGroups: SidebarNavGroup[] = useMemo(() => {
    const currentPath = location.pathname;
    const isPathActive = (path: string) => currentPath === path;
    const isPathInMenu = (path: string) =>
      currentPath === path || currentPath.startsWith(`${path}/`);

    // Plugin menus come from the runtime API (topologically sorted).
    const allMenus = (plugins$.data ?? []).flatMap((plugin) => plugin.menus ?? []);
    const mapMenuItem = (menu: MenuItemInfo): SidebarNavItem => {
      const subItems = menu.items?.map((sub) => ({
        isActive: isPathActive(sub.path),
        title: sub.title.includes(":") ? t(sub.title) : sub.title,
        url: sub.path,
      }));

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

    // Runtime menu — statically declared, permission-filtered. Lives alongside
    // the plugin menus so the cpanel exposes a single unified navigation.
    // The paths are first-class under /cpanel/ (no /admin/ subpath): everything
    // is cpanel.
    const runtimeCandidates: Array<SidebarNavItem | false> = [
      can("workers:read") && {
        icon: "lucide:gauge",
        isActive: isPathInMenu("/overview"),
        title: t("nav.overview"),
        url: "/overview",
      },
      can("keys:read") && {
        icon: "lucide:key-round",
        isActive: isPathInMenu("/keys"),
        title: t("nav.keys"),
        url: "/keys",
      },
      can("workers:read") && {
        icon: "lucide:cpu",
        isActive: isPathInMenu("/workers"),
        title: t("nav.workers"),
        url: "/workers",
      },
      can("plugins:read") && {
        icon: "lucide:puzzle",
        isActive: isPathInMenu("/plugins"),
        title: t("nav.plugins"),
        url: "/plugins",
      },
    ];
    const runtimeItems = runtimeCandidates.filter((item): item is SidebarNavItem => item !== false);

    const groups: SidebarNavGroup[] = [];
    if (runtimeItems.length > 0) {
      groups.push({ items: runtimeItems, label: t("nav.runtime") });
    }
    if (allMenus.length > 0) {
      // "Plugins" section heading + extra top spacing to separate from the
      // "Runtime" group above. The Runtime group also has a "Plugins" menu
      // item (the install/manage page) — they coexist by hierarchy: this
      // section heading lists micro-frontends contributed BY plugins, the
      // Runtime item is the runtime-side admin page that manages plugins.
      groups.push({
        className: "mt-4",
        items: allMenus.map(mapMenuItem),
        label: t("nav.plugins"),
      });
    }
    return groups;
  }, [can, location.pathname, plugins$.data, t]);

  return (
    <MainLayout
      apps={apps}
      breadcrumbs={header?.breadcrumbs ?? breadcrumbs}
      groups={navGroups}
      header={header ?? undefined}
      LinkComponent={Link}
      sidebarFooterAction={{
        icon: <Icon icon="lucide:log-out" />,
        onClick: logout,
        title: t("nav.logout"),
      }}
    >
      {/* The outlet wrapper deliberately omits horizontal/vertical padding so
          plugin iframes (`$.tsx`) — whose React apps already render their own
          `p-6` content well — don't get double padding. Routes that own their
          full canvas (Keys / Overview / Workers / Plugins) add their own
          `p-4` via the inner tab/FileBrowser wrappers. */}
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
        <ApiKeyAuthProvider>
          <HeaderProvider>
            <RootLayoutContent />
            <Toaster />
          </HeaderProvider>
        </ApiKeyAuthProvider>
      </QueryClientProvider>
    </IconProvider>
  );
}
