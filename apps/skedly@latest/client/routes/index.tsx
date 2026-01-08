import { createFileRoute, redirect } from "@tanstack/react-router";
import { clearSessionCache, getSession } from "~/lib/api";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    clearSessionCache();
    const session = await getSession();
    if (!session) {
      throw redirect({ to: "/sign-in" });
    }
    return { session };
  },
  component: Index,
});

function Index() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Skedly</h1>
      <p className="text-gray-600">Scheduling System</p>
    </div>
  );
}
