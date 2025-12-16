import { Button } from "./button";
import { Icon } from "./icon";

interface SelectionToolbarLabels {
  delete?: string;
  download?: string;
  move?: string;
  selected?: string;
}

interface SelectionToolbarProps {
  count: number;
  labels?: SelectionToolbarLabels;
  onClear: () => void;
  onDelete?: () => void;
  onDownload?: () => void;
  onMove?: () => void;
}

const defaultLabels: SelectionToolbarLabels = {
  delete: "Delete",
  download: "Download",
  move: "Move",
  selected: "selected",
};

export function SelectionToolbar({
  count,
  labels = defaultLabels,
  onClear,
  onDelete,
  onDownload,
  onMove,
}: SelectionToolbarProps) {
  if (count === 0) return null;

  const l = { ...defaultLabels, ...labels };

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background p-2 shadow-sm">
      <span className="px-2 text-sm font-medium">
        {count} {l.selected}
      </span>
      <div className="h-4 w-px bg-border" />
      {onMove && (
        <Button className="gap-2" size="sm" variant="ghost" onClick={onMove}>
          <Icon className="size-4" icon="lucide:folder-input" />
          {l.move}
        </Button>
      )}
      {onDownload && (
        <Button className="gap-2" size="sm" variant="ghost" onClick={onDownload}>
          <Icon className="size-4" icon="lucide:download" />
          {l.download}
        </Button>
      )}
      {onDelete && (
        <Button
          className="gap-2 text-destructive hover:text-destructive"
          size="sm"
          variant="ghost"
          onClick={onDelete}
        >
          <Icon className="size-4" icon="lucide:trash-2" />
          {l.delete}
        </Button>
      )}
      <div className="h-4 w-px bg-border" />
      <Button size="sm" variant="ghost" onClick={onClear}>
        <Icon className="size-4" icon="lucide:x" />
      </Button>
    </div>
  );
}
