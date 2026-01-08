import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AuthProvider } from "~/providers/auth";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <AuthProvider>
      <div className="min-h-screen">
        <Outlet />
      </div>
    </AuthProvider>
  );
}
