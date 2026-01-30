import { registry } from "virtual:icons";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { IconProvider } from "@zomme/shadcn-react";

export const Route = createRootRoute({
  component: () => (
    <IconProvider registry={registry}>
      <Outlet />
    </IconProvider>
  ),
});
