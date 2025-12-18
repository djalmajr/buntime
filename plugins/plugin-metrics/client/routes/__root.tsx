import { registry } from "virtual:icons";
import { IconProvider } from "@buntime/shadcn-ui";
import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => (
    <IconProvider registry={registry}>
      <Outlet />
    </IconProvider>
  ),
});
