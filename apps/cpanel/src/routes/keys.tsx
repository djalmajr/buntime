import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeysTab } from "~/components/admin/tabs/keys";
import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import { useApiKey } from "~/contexts/api-key-auth-context";
import { useHeader } from "~/contexts/header-context";

export const Route = createFileRoute("/keys")({
  component: KeysRoute,
  loader: () => ({ breadcrumb: "nav.keys" }),
});

function KeysRoute() {
  const { t } = useTranslation();
  const { can } = useApiKey();
  const { setHeader } = useHeader();
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!can("keys:create")) {
      setHeader(null);
      return () => setHeader(null);
    }
    setHeader({
      actions: (
        <Button onClick={() => setCreateOpen(true)} size="sm" type="button">
          <Icon className="size-4" icon="lucide:plus" />
          {t("admin.keys.createTitle")}
        </Button>
      ),
    });
    return () => setHeader(null);
  }, [can, setHeader, t]);

  return <KeysTab createOpen={createOpen} onCreateOpenChange={setCreateOpen} />;
}
