import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { clearSessionCache, getSession } from "~/lib/api";

export const Route = createFileRoute("/sign-up")({
  beforeLoad: async () => {
    clearSessionCache();
    const session = await getSession();
    if (session) {
      throw redirect({ to: "/" });
    }
  },
  component: SignUpComponent,
});

function SignUpComponent() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Create your account
          </h2>
        </div>
        <div className="mt-8 space-y-6">
          <p className="text-center text-sm text-gray-600">
            Or{" "}
            <Link to="/sign-in" className="font-medium text-indigo-600 hover:text-indigo-500">
              sign in to your existing account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
