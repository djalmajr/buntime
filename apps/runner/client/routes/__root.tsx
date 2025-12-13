import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { MainLayout, type SidebarNavGroup } from "~/components/layouts/main-layout";
import { Toaster } from "~/components/ui/sonner";
import { HeaderProvider, useHeader } from "~/contexts/header-context";
import i18n from "~/helpers/i18n";
import { queryClient } from "~/helpers/query-client";
import { useBreadcrumbs } from "~/hooks/use-breadcrumbs";
import { hasPlugin, usePlugins } from "~/hooks/use-plugins";

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
    const platformItems = [];

    // Dashboard requires plugin-metrics
    if (hasPlugin(plugins$.data, "@buntime/plugin-metrics")) {
      platformItems.push({
        icon: "lucide:gauge",
        title: t("nav.dashboard"),
        url: "/",
      });
    }

    // Deployments is always visible (core feature)
    platformItems.push({
      icon: "lucide:folder",
      title: t("nav.deployments"),
      url: "/deployments",
    });

    // Redirects requires plugin-proxy
    if (hasPlugin(plugins$.data, "@buntime/plugin-proxy")) {
      platformItems.push({
        icon: "lucide:network",
        title: t("nav.redirects"),
        url: "/redirects",
      });
    }

    return [
      {
        items: platformItems,
        label: t("nav.platform"),
      },
    ];
  }, [plugins$.data, t]);

  return (
    <MainLayout
      apps={apps}
      breadcrumbs={breadcrumbs}
      groups={navGroups}
      header={header ?? undefined}
      LinkComponent={Link}
      user={userData}
    >
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
        <Outlet />
      </div>
    </MainLayout>
  );
}

function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <HeaderProvider>
        <RootLayoutContent />
        <Toaster />
      </HeaderProvider>
    </QueryClientProvider>
  );
}
