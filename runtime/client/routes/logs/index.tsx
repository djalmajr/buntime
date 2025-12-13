import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useHeader } from "~/contexts/header-context";

function LogsPage() {
  const { setHeader } = useHeader();

  useEffect(() => {
    setHeader({
      title: "Logs",
    });

    return () => {
      setHeader(null);
    };
  }, [setHeader]);

  return <piercing-fragment-outlet fragment-id="logs" />;
}

export const Route = createFileRoute("/logs/")({
  component: LogsPage,
});
