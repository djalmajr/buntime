import { useTranslation } from "react-i18next";
import { Icon } from "~/components/ui/icon";

/**
 * Full-page loading state shown while the cpanel verifies an existing
 * API key from sessionStorage.
 */
export function LoadingSplash() {
  const { t } = useTranslation();
  return (
    <div className="bg-background flex min-h-screen w-full items-center justify-center">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Icon icon="lucide:loader-circle" className="size-4 animate-spin" />
        {t("admin.common.loading")}
      </div>
    </div>
  );
}
