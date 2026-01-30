import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";

interface SelectionToolbarProps {
  count: number;
  onClear: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onMove?: () => void;
}

export function SelectionToolbar({
  count,
  onClear,
  onDelete,
  onDownload,
  onMove,
}: SelectionToolbarProps) {
  const { t } = useTranslation("deployments");

  if (count === 0) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background p-2 shadow-sm">
      <span className="px-2 text-sm font-medium">{t("batch.selected", { count })}</span>
      <div className="h-4 w-px bg-border" />
      {onMove && (
        <Button className="gap-2" size="sm" variant="ghost" onClick={onMove}>
          <Icon className="size-4" icon="lucide:folder-input" />
          {t("actions.move")}
        </Button>
      )}
      <Button className="gap-2" size="sm" variant="ghost" onClick={onDownload}>
        <Icon className="size-4" icon="lucide:download" />
        {t("actions.download")}
      </Button>
      <Button
        className="gap-2 text-destructive hover:text-destructive"
        size="sm"
        variant="ghost"
        onClick={onDelete}
      >
        <Icon className="size-4" icon="lucide:trash-2" />
        {t("actions.delete")}
      </Button>
      <div className="h-4 w-px bg-border" />
      <Button size="sm" variant="ghost" onClick={onClear}>
        <Icon className="size-4" icon="lucide:x" />
      </Button>
    </div>
  );
}
