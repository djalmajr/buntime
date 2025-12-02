import type * as React from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { NavMenus } from "~/components/navigation/nav-menus";
import { NavUser } from "~/components/navigation/nav-user";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "~/components/ui/sidebar";

const FolderIcon = () => <Icon className="size-4" icon="lucide:folder" />;
const GaugeIcon = () => <Icon className="size-4" icon="lucide:gauge" />;
const NetworkIcon = () => <Icon className="size-4" icon="lucide:network" />;
const TerminalIcon = () => <Icon className="size-4.5" icon="lucide:terminal" />;

const userData = {
  avatar: "/avatars/default.jpg",
  email: "admin@buntime.dev",
  name: "Buntime Admin",
};

export function NavMain({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation();

  const navMain = [
    {
      icon: GaugeIcon,
      title: t("nav.dashboard"),
      url: "/",
    },
    {
      icon: FolderIcon,
      title: t("nav.deployments"),
      url: "/deployments",
    },
    {
      icon: NetworkIcon,
      title: t("nav.redirects"),
      url: "/redirects",
    },
  ];

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-7 items-center justify-center rounded">
            <TerminalIcon />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{t("nav.appName")}</span>
            <span className="truncate text-xs">{t("nav.appDescription")}</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavMenus items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={userData} />
      </SidebarFooter>
    </Sidebar>
  );
}
