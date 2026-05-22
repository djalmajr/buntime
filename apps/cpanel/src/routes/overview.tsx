import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { OverviewTab } from "~/components/admin/tabs/overview";
import { useHeader } from "~/contexts/header-context";

export const Route = createFileRoute("/overview")({
  component: OverviewRoute,
  loader: () => ({ breadcrumb: "nav.overview" }),
});

function OverviewRoute() {
  const { setHeader } = useHeader();

  useEffect(() => {
    setHeader(null);
    return () => setHeader(null);
  }, [setHeader]);

  return <OverviewTab />;
}
