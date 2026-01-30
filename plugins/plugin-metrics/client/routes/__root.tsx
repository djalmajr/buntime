import { registry } from "virtual:icons";
import { IconProvider } from "@zomme/shadcn-react";
import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => (
    <IconProvider registry={registry}>
      <Outlet />
    </IconProvider>
  ),
});
