import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { MainLayout } from "~/components/layouts/main-layout";
import { HeaderProvider, useHeader } from "~/contexts/header-context";
import i18n from "~/helpers/i18n";
import { queryClient } from "~/helpers/query-client";
import { useBreadcrumbs } from "~/hooks/use-breadcrumbs";

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
  const { t } = useTranslation("keyval");
  const { t: tMetrics } = useTranslation("metrics");
  const { t: tDurable } = useTranslation("durable");
  const { t: tGateway } = useTranslation("gateway");
  const { t: tAuthz } = useTranslation("authz");
  const { header } = useHeader();
  const breadcrumbs = useBreadcrumbs({ i18n });

  const apps = [
    {
      description: t("header.subtitle"),
      icon: <Icon className="size-4" icon="lucide:database" />,
      isActive: true,
      name: t("header.title"),
      url: "/",
    },
  ];

  const navGroups = [
    {
      items: [
        {
          icon: "lucide:database",
          isActive: true,
          items: [
            { title: t("nav.dashboard"), url: "/keyval" },
            { title: t("nav.entries"), url: "/keyval/entries" },
            { title: t("nav.queue"), url: "/keyval/queue" },
            { title: t("nav.search"), url: "/keyval/search" },
            { title: t("nav.watch"), url: "/keyval/watch" },
            { title: t("nav.atomic"), url: "/keyval/atomic" },
            { title: t("nav.metrics"), url: "/keyval/metrics" },
          ],
          title: t("nav.keyval"),
        },
        {
          icon: "lucide:activity",
          isActive: true,
          items: [
            { title: tMetrics("nav.dashboard"), url: "/metrics" },
            { title: tMetrics("nav.prometheus"), url: "/metrics/prometheus" },
            { title: tMetrics("nav.workers"), url: "/metrics/workers" },
          ],
          title: tMetrics("nav.metrics"),
        },
        {
          icon: "lucide:box",
          isActive: true,
          items: [{ title: tDurable("nav.dashboard"), url: "/durable" }],
          title: tDurable("nav.durable"),
        },
        {
          icon: "lucide:shield",
          isActive: true,
          items: [
            { title: tGateway("nav.dashboard"), url: "/gateway" },
            { title: tGateway("nav.cache"), url: "/gateway/cache" },
          ],
          title: tGateway("nav.gateway"),
        },
        {
          icon: "lucide:lock",
          isActive: true,
          items: [
            { title: tAuthz("nav.dashboard"), url: "/authz" },
            { title: tAuthz("nav.policies"), url: "/authz/policies" },
            { title: tAuthz("nav.evaluate"), url: "/authz/evaluate" },
          ],
          title: tAuthz("nav.authz"),
        },
      ],
    },
  ];

  return (
    <MainLayout
      apps={apps}
      breadcrumbs={breadcrumbs}
      groups={navGroups}
      header={header ?? undefined}
      LinkComponent={Link}
      user={userData}
    >
      <Outlet />
    </MainLayout>
  );
}

function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <HeaderProvider>
        <RootLayoutContent />
      </HeaderProvider>
    </QueryClientProvider>
  );
}
