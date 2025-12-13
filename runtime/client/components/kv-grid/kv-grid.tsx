import type { KvEntry, KvKey } from "@buntime/keyval";
import DataEditor, {
  CompactSelection,
  type EditableGridCell,
  type GridCell,
  GridCellKind,
  type GridColumn,
  type GridSelection,
  type Item,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "~/components/icon";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Skeleton } from "~/components/ui/skeleton";

import type { KvGridProps } from "./kv-grid.types";

const COLUMN_KEY = 0;
const COLUMN_VALUE = 1;
const COLUMN_VERSIONSTAMP = 2;

function formatKey(key: KvKey): string {
  return JSON.stringify(key);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return value.length > 100 ? `${value.slice(0, 100)}...` : value;
  }
  const json = JSON.stringify(value, null, 2);
  return json.length > 100 ? `${json.slice(0, 100)}...` : json;
}

function createEmptySelection(): GridSelection {
  return {
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
  };
}

export function KvGrid({
  entries,
  loading = false,
  onDelete,
  onDeleteMultiple,
  onEdit,
  onRefresh,
}: KvGridProps) {
  const { t } = useTranslation("keyval.entries");

  const [selection, setSelection] = useState<GridSelection>(createEmptySelection);
  const [editDialog, setEditDialog] = useState<{
    entry: KvEntry;
    open: boolean;
    value: string;
  } | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{
    keys: KvKey[];
    open: boolean;
  } | null>(null);

  const columns: GridColumn[] = useMemo(
    () => [
      { id: "key", title: t("key"), width: 300 },
      { id: "value", title: t("value"), width: 400, grow: 1 },
      { id: "versionstamp", title: t("versionstamp"), width: 180 },
    ],
    [t],
  );

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const entry = entries[row];
      if (!entry) {
        return {
          allowOverlay: false,
          data: "",
          displayData: "",
          kind: GridCellKind.Text,
        };
      }

      switch (col) {
        case COLUMN_KEY:
          return {
            allowOverlay: true,
            copyData: formatKey(entry.key),
            data: formatKey(entry.key),
            displayData: formatKey(entry.key),
            kind: GridCellKind.Text,
            readonly: true,
          };
        case COLUMN_VALUE:
          return {
            allowOverlay: true,
            copyData: JSON.stringify(entry.value),
            data: formatValue(entry.value),
            displayData: formatValue(entry.value),
            kind: GridCellKind.Text,
          };
        case COLUMN_VERSIONSTAMP:
          return {
            allowOverlay: true,
            copyData: entry.versionstamp ?? "",
            data: entry.versionstamp?.slice(0, 16) ?? "-",
            displayData: entry.versionstamp?.slice(0, 16) ?? "-",
            kind: GridCellKind.Text,
            readonly: true,
          };
        default:
          return {
            allowOverlay: false,
            data: "",
            displayData: "",
            kind: GridCellKind.Text,
          };
      }
    },
    [entries],
  );

  const handleCellEdited = useCallback(
    ([col, row]: Item, newValue: EditableGridCell) => {
      if (col !== COLUMN_VALUE) return;
      const entry = entries[row];
      if (!entry) return;

      if (newValue.kind === GridCellKind.Text) {
        setEditDialog({
          entry,
          open: true,
          value: JSON.stringify(entry.value, null, 2),
        });
      }
    },
    [entries],
  );

  const handleCellActivated = useCallback(
    ([col, row]: Item) => {
      if (col !== COLUMN_VALUE) return;
      const entry = entries[row];
      if (!entry) return;

      setEditDialog({
        entry,
        open: true,
        value: JSON.stringify(entry.value, null, 2),
      });
    },
    [entries],
  );

  const handleSaveEdit = useCallback(async () => {
    if (!editDialog || !onEdit) return;

    try {
      const value = JSON.parse(editDialog.value);
      await onEdit(editDialog.entry.key, value);
      setEditDialog(null);
    } catch {
      // JSON parse error - keep dialog open
    }
  }, [editDialog, onEdit]);

  const handleDeleteSelected = useCallback(() => {
    const selectedRows = selection.rows;
    if (selectedRows.length === 0) return;

    const keys: KvKey[] = [];
    for (const row of selectedRows) {
      const entry = entries[row];
      if (entry) {
        keys.push(entry.key);
      }
    }

    if (keys.length > 0) {
      setDeleteDialog({ keys, open: true });
    }
  }, [entries, selection.rows]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteDialog || deleteDialog.keys.length === 0) return;

    const firstKey = deleteDialog.keys[0];
    if (deleteDialog.keys.length === 1 && onDelete && firstKey) {
      await onDelete(firstKey);
    } else if (onDeleteMultiple) {
      await onDeleteMultiple(deleteDialog.keys);
    }

    setDeleteDialog(null);
    setSelection(createEmptySelection());
  }, [deleteDialog, onDelete, onDeleteMultiple]);

  const selectedCount = useMemo(() => selection.rows.length, [selection.rows]);

  const theme = useMemo(
    () => ({
      accentColor: "hsl(var(--primary))",
      accentLight: "hsl(var(--primary) / 0.1)",
      baseFontStyle: "13px",
      bgBubble: "hsl(var(--muted))",
      bgBubbleSelected: "hsl(var(--primary))",
      bgCell: "hsl(var(--background))",
      bgCellMedium: "hsl(var(--muted))",
      bgHeader: "hsl(var(--muted))",
      bgHeaderHasFocus: "hsl(var(--muted))",
      bgHeaderHovered: "hsl(var(--accent))",
      bgSearchResult: "hsl(var(--primary) / 0.2)",
      borderColor: "hsl(var(--border))",
      drilldownBorder: "hsl(var(--border))",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      headerFontStyle: "600 13px",
      linkColor: "hsl(var(--primary))",
      textBubble: "hsl(var(--foreground))",
      textDark: "hsl(var(--foreground))",
      textHeader: "hsl(var(--foreground))",
      textHeaderSelected: "hsl(var(--foreground))",
      textLight: "hsl(var(--muted-foreground))",
      textMedium: "hsl(var(--muted-foreground))",
    }),
    [],
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton className="h-10 w-full" key={i} />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Icon className="mb-4 size-12" icon="lucide:database" />
        <p>{t("noEntries")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        {onRefresh && (
          <Button size="sm" variant="outline" onClick={onRefresh}>
            <Icon className="mr-2 size-4" icon="lucide:refresh-cw" />
            {t("refresh")}
          </Button>
        )}
        {selectedCount > 0 && (
          <Button size="sm" variant="destructive" onClick={handleDeleteSelected}>
            <Icon className="mr-2 size-4" icon="lucide:trash-2" />
            {t("deleteSelected", { count: selectedCount })}
          </Button>
        )}
        <div className="ml-auto text-sm text-muted-foreground">
          {t("entriesCount", { count: entries.length })}
        </div>
      </div>

      {/* Grid */}
      <div className="h-[500px] overflow-hidden rounded-lg border">
        <DataEditor
          columns={columns}
          getCellContent={getCellContent}
          gridSelection={selection}
          rowMarkers="both"
          rows={entries.length}
          smoothScrollX
          smoothScrollY
          theme={theme}
          onCellActivated={handleCellActivated}
          onCellEdited={handleCellEdited}
          onGridSelectionChange={setSelection}
        />
      </div>

      {/* Edit Dialog */}
      <Dialog
        open={editDialog?.open ?? false}
        onOpenChange={(open: boolean) => !open && setEditDialog(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("editValue")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <span className="text-sm font-medium">{t("key")}</span>
              <code className="mt-1 block rounded bg-muted p-2 text-sm">
                {editDialog ? formatKey(editDialog.entry.key) : ""}
              </code>
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="edit-value">
                {t("value")}
              </label>
              <textarea
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                id="edit-value"
                rows={15}
                value={editDialog?.value ?? ""}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  editDialog && setEditDialog({ ...editDialog, value: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t("cancel")}</Button>
            </DialogClose>
            <Button onClick={handleSaveEdit}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialog?.open ?? false}
        onOpenChange={(open: boolean) => !open && setDeleteDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmDeleteTitle")}</DialogTitle>
            <DialogDescription>
              {deleteDialog?.keys.length === 1
                ? t("confirmDelete")
                : t("confirmDeleteMultiple", {
                    count: deleteDialog?.keys.length ?? 0,
                  })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t("cancel")}</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
