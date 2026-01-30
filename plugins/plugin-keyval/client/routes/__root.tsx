import { registry } from "virtual:icons";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { IconProvider } from "../components/ui/icon";

export const Route = createRootRoute({
  component: () => (
    <IconProvider registry={registry}>
      <div className="h-screen w-full">
        <Outlet />
      </div>
    </IconProvider>
  ),
});
