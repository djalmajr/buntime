import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TopBar } from "~/components/top-bar";
import { useAppearanceState } from "~/hooks/use-appearance";

function RootLayout() {
  // Initialize appearance (light/dark mode) at root level
  useAppearanceState();

  return (
    <div className="bg-background text-foreground flex h-screen w-screen flex-col overflow-hidden">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
