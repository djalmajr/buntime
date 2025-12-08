import { createFileRoute, Outlet } from "@tanstack/react-router";
import { NavMain } from "~/components/navigation/nav-main";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";

function DashboardLayout() {
  return (
    <SidebarProvider>
      <NavMain />
      <SidebarInset>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}

export const Route = createFileRoute("/_dashboard")({
  component: DashboardLayout,
});
