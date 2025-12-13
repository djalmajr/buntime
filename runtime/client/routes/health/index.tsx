import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useHeader } from "~/contexts/header-context";

function HealthPage() {
  const { setHeader } = useHeader();

  useEffect(() => {
    setHeader({
      title: "Health",
    });

    return () => {
      setHeader(null);
    };
  }, [setHeader]);

  return <piercing-fragment-outlet fragment-id="health" />;
}

export const Route = createFileRoute("/health/")({
  component: HealthPage,
});
