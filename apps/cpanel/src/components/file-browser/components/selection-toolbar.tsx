import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";

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
  if (count === 0) return null;

  return (
    <div className="bg-background flex items-center gap-2 rounded-lg border p-2 shadow-sm">
      <span className="px-2 text-sm font-medium">{count} selected</span>
      <div className="bg-border h-4 w-px" />
      {onMove && (
        <Button className="gap-2" size="sm" variant="ghost" onClick={onMove}>
          <Icon className="size-4" icon="lucide:folder-input" />
          Move
        </Button>
      )}
      <Button className="gap-2" size="sm" variant="ghost" onClick={onDownload}>
        <Icon className="size-4" icon="lucide:download" />
        Download
      </Button>
      <Button
        className="text-destructive hover:text-destructive gap-2"
        size="sm"
        variant="ghost"
        onClick={onDelete}
      >
        <Icon className="size-4" icon="lucide:trash-2" />
        Delete
      </Button>
      <div className="bg-border h-4 w-px" />
      <Button size="sm" variant="ghost" onClick={onClear}>
        <Icon className="size-4" icon="lucide:x" />
      </Button>
    </div>
  );
}
