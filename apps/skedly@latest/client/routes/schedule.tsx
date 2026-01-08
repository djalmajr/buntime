import { createFileRoute, redirect } from "@tanstack/react-router";
import { clearSessionCache, getSession } from "~/lib/api";

export const Route = createFileRoute("/schedule")({
  beforeLoad: async () => {
    clearSessionCache();
    const session = await getSession();
    if (!session) {
      throw redirect({ to: "/sign-in" });
    }
    return { session };
  },
  component: Schedule,
});

function Schedule() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Schedule</h1>
      <p className="text-gray-600">Schedule page coming soon...</p>
    </div>
  );
}
