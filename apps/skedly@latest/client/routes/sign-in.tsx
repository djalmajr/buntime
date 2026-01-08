import { createFileRoute, redirect } from "@tanstack/react-router";
import { clearSessionCache, getSession } from "~/lib/api";

export const Route = createFileRoute("/sign-in")({
  beforeLoad: async () => {
    clearSessionCache();
    const session = await getSession();
    if (session) {
      throw redirect({ to: "/" });
    }
  },
  component: SignIn,
});

function SignIn() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md w-full space-y-8 p-8">
        <h2 className="text-2xl font-bold text-center">Sign in to Skedly</h2>
        <p className="text-gray-600 text-center">Authentication coming soon...</p>
      </div>
    </div>
  );
}
