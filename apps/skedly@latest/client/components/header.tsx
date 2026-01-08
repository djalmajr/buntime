import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "~/providers/auth";

export function Header() {
  const { session, isLoading, logout } = useAuth();
  const router = useRouterState();
  const noHeaderRoutes = ["/sign-in", "/sign-up"];
  const showHeader = !noHeaderRoutes.includes(router.location.pathname);

  if (!showHeader) return null;

  return (
    <header className="p-4 flex gap-4 bg-white border-b justify-between items-center">
      <nav className="flex flex-row">
        <div className="px-4 font-bold">
          <Link to="/">Skedly</Link>
        </div>
      </nav>
      <div>
        {isLoading ? (
          <div>Loading...</div>
        ) : session?.user ? (
          <div className="flex gap-4 items-center">
            <span>Hello, {session.user.name}</span>
            <Link to="/schedule" className="text-blue-600 hover:underline">
              Schedule
            </Link>
            <button
              type="button"
              onClick={logout}
              className="px-4 py-2 border rounded hover:bg-gray-100"
            >
              Logout
            </button>
          </div>
        ) : (
          <div className="flex gap-4">
            <Link to="/sign-in" className="px-4 py-2 border rounded hover:bg-gray-100">
              Sign In
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
