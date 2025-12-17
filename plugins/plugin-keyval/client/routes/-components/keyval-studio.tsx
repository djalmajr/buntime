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
import {
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  Input,
  Label,
  ScrollArea,
  Separator,
  Skeleton,
} from "@buntime/shadcn-ui";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { kv } from "~/helpers/kv";

interface PrefixInfo {
  count: number;
  prefix: string;
}

const COLUMN_KEY = 0;
const COLUMN_VALUE = 1;
const COLUMN_VERSIONSTAMP = 2;

function formatKey(key: KvKey): string {
  return key.join("/");
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

function parsePrefix(prefix: string): KvKey {
  if (!prefix.trim()) return [];
  return prefix.split("/").map((p) => {
    const trimmed = p.trim();
    const num = Number(trimmed);
    return Number.isNaN(num) ? trimmed : num;
  });
}

function createEmptySelection(): GridSelection {
  return {
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
  };
}

export function KeyvalStudio() {
  const { t } = useTranslation();

  // Sidebar state
  const [prefixes, setPrefixes] = useState<PrefixInfo[]>([]);
  const [selectedPrefix, setSelectedPrefix] = useState<string>("");
  const [prefixSearch, setPrefixSearch] = useState("");
  const [loadingPrefixes, setLoadingPrefixes] = useState(false);

  // Grid state
  const [entries, setEntries] = useState<KvEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<GridSelection>(createEmptySelection);

  // Pagination
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [queryTime, setQueryTime] = useState(0);

  // Dialogs
  const [editDialog, setEditDialog] = useState<{
    entry: KvEntry;
    open: boolean;
    value: string;
  } | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{
    keys: KvKey[];
    open: boolean;
  } | null>(null);
  const [addDialog, setAddDialog] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("{}");

  const gridRef = useRef<HTMLDivElement>(null);
  const [gridSize, setGridSize] = useState({ height: 500, width: 800 });

  // Observe grid container size
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const newWidth = Math.floor(rect.width);
      const newHeight = Math.floor(rect.height);
      if (newWidth > 0 && newHeight > 0) {
        setGridSize((prev) => {
          if (prev.width === newWidth && prev.height === newHeight) {
            return prev;
          }
          return { height: newHeight, width: newWidth };
        });
      }
    };

    requestAnimationFrame(updateSize);

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(updateSize);
    });
    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  // Load top-level prefixes
  const loadPrefixes = useCallback(async () => {
    setLoadingPrefixes(true);
    try {
      const results: Map<string, number> = new Map();
      for await (const entry of kv.list([], { limit: 1000 })) {
        const firstPart = String(entry.key[0] ?? "");
        if (firstPart) {
          results.set(firstPart, (results.get(firstPart) ?? 0) + 1);
        }
      }
      const prefixList = Array.from(results.entries())
        .map(([prefix, count]) => ({ count, prefix }))
        .sort((a, b) => a.prefix.localeCompare(b.prefix));
      setPrefixes(prefixList);
    } catch (error) {
      console.error("Failed to load prefixes:", error);
    } finally {
      setLoadingPrefixes(false);
    }
  }, []);

  // Load entries for selected prefix
  const loadEntries = useCallback(async () => {
    setLoading(true);
    const startTime = performance.now();
    try {
      const prefix = parsePrefix(selectedPrefix);
      const results: KvEntry[] = [];
      for await (const entry of kv.list(prefix, { limit: 1000 })) {
        results.push(entry);
      }
      setEntries(results);
      setTotalCount(results.length);
      setCurrentPage(0);
      setQueryTime(Math.round(performance.now() - startTime));
    } catch (error) {
      console.error("Failed to load entries:", error);
    } finally {
      setLoading(false);
    }
  }, [selectedPrefix]);

  // Initial load
  useEffect(() => {
    loadPrefixes();
  }, [loadPrefixes]);

  // Load entries when prefix changes
  useEffect(() => {
    if (selectedPrefix !== undefined) {
      loadEntries();
    }
  }, [selectedPrefix, loadEntries]);

  // Paginated entries
  const paginatedEntries = useMemo(() => {
    const start = currentPage * pageSize;
    return entries.slice(start, start + pageSize);
  }, [entries, currentPage, pageSize]);

  const totalPages = Math.ceil(totalCount / pageSize);

  // Grid columns
  const columns: GridColumn[] = useMemo(
    () => [
      { id: "key", title: "key", width: 250 },
      { id: "value", title: "value", width: 400, grow: 1 },
      { id: "versionstamp", title: "versionstamp", width: 160 },
    ],
    [],
  );

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const entry = paginatedEntries[row];
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
    [paginatedEntries],
  );

  const handleCellActivated = useCallback(
    ([col, row]: Item) => {
      if (col !== COLUMN_VALUE) return;
      const entry = paginatedEntries[row];
      if (!entry) return;

      setEditDialog({
        entry,
        open: true,
        value: JSON.stringify(entry.value, null, 2),
      });
    },
    [paginatedEntries],
  );

  const handleCellEdited = useCallback(
    ([col, row]: Item, newValue: EditableGridCell) => {
      if (col !== COLUMN_VALUE) return;
      const entry = paginatedEntries[row];
      if (!entry) return;

      if (newValue.kind === GridCellKind.Text) {
        setEditDialog({
          entry,
          open: true,
          value: JSON.stringify(entry.value, null, 2),
        });
      }
    },
    [paginatedEntries],
  );

  const handleSaveEdit = useCallback(async () => {
    if (!editDialog) return;

    try {
      const value = JSON.parse(editDialog.value);
      await kv.set(editDialog.entry.key, value);
      setEditDialog(null);
      await loadEntries();
    } catch {
      // JSON parse error
    }
  }, [editDialog, loadEntries]);

  const handleDeleteSelected = useCallback(() => {
    const selectedRows = selection.rows;
    if (selectedRows.length === 0) return;

    const keys: KvKey[] = [];
    for (const row of selectedRows) {
      const entry = paginatedEntries[row];
      if (entry) {
        keys.push(entry.key);
      }
    }

    if (keys.length > 0) {
      setDeleteDialog({ keys, open: true });
    }
  }, [paginatedEntries, selection.rows]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteDialog || deleteDialog.keys.length === 0) return;

    for (const key of deleteDialog.keys) {
      await kv.delete(key, { exact: true });
    }

    setDeleteDialog(null);
    setSelection(createEmptySelection());
    await loadEntries();
    await loadPrefixes();
  }, [deleteDialog, loadEntries, loadPrefixes]);

  const handleAddRecord = useCallback(async () => {
    try {
      const key = parsePrefix(newKey);
      const value = JSON.parse(newValue);
      await kv.set(key, value);
      setAddDialog(false);
      setNewKey("");
      setNewValue("{}");
      await loadEntries();
      await loadPrefixes();
    } catch {
      // JSON parse error
    }
  }, [newKey, newValue, loadEntries, loadPrefixes]);

  const selectedCount = useMemo(() => selection.rows.length, [selection.rows]);

  const filteredPrefixes = useMemo(() => {
    if (!prefixSearch) return prefixes;
    return prefixes.filter((p) => p.prefix.toLowerCase().includes(prefixSearch.toLowerCase()));
  }, [prefixes, prefixSearch]);

  // Get computed CSS colors for glide-data-grid theme (convert oklch to rgb via canvas)
  const [colorsReady, setColorsReady] = useState(false);
  const [computedColors, setComputedColors] = useState<Record<string, string>>({
    accent: "#f4f4f5",
    background: "#ffffff",
    border: "#e4e4e7",
    foreground: "#09090b",
    muted: "#f4f4f5",
    mutedForeground: "#71717a",
    primary: "#6366f1",
  });

  useEffect(() => {
    // Use canvas to convert any CSS color to RGB format
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const computeColor = (cssVar: string, fallback: string): string => {
      // Create element with the CSS variable as background
      const el = document.createElement("div");
      el.style.backgroundColor = `var(${cssVar})`;
      document.body.appendChild(el);
      const rawColor = getComputedStyle(el).backgroundColor;
      document.body.removeChild(el);

      // Use canvas to convert to RGB
      ctx.fillStyle = fallback; // Reset
      ctx.fillStyle = rawColor;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return `rgb(${r}, ${g}, ${b})`;
    };

    setComputedColors({
      accent: computeColor("--accent", "#f4f4f5"),
      background: computeColor("--background", "#ffffff"),
      border: computeColor("--border", "#e4e4e7"),
      foreground: computeColor("--foreground", "#09090b"),
      muted: computeColor("--muted", "#f4f4f5"),
      mutedForeground: computeColor("--muted-foreground", "#71717a"),
      primary: computeColor("--primary", "#6366f1"),
    });
    setColorsReady(true);
  }, []);

  const theme = useMemo(
    () => ({
      accentColor: computedColors.primary || "#6366f1",
      accentFg: "#ffffff",
      accentLight: "rgba(99, 102, 241, 0.1)",
      baseFontStyle: "13px",
      bgBubble: computedColors.muted || "#f4f4f5",
      bgBubbleSelected: computedColors.primary || "#6366f1",
      bgCell: computedColors.background || "#ffffff",
      bgCellMedium: computedColors.muted || "#f4f4f5",
      bgHeader: computedColors.muted || "#f4f4f5",
      bgHeaderHasFocus: computedColors.muted || "#f4f4f5",
      bgHeaderHovered: computedColors.accent || "#f4f4f5",
      bgIconHeader: computedColors.mutedForeground || "#71717a",
      bgSearchResult: "rgba(99, 102, 241, 0.2)",
      borderColor: computedColors.border || "rgba(0, 0, 0, 0.08)",
      bubbleHeight: 20,
      bubbleMargin: 4,
      bubblePadding: 6,
      cellHorizontalPadding: 8,
      cellVerticalPadding: 3,
      checkboxMaxSize: 18,
      drilldownBorder: "rgba(0, 0, 0, 0)",
      editorFontSize: "13px",
      fgIconHeader: "#ffffff",
      fontFamily: "ui-monospace, monospace",
      headerFontStyle: "600 13px",
      headerIconSize: 18,
      horizontalBorderColor: computedColors.border || "rgba(0, 0, 0, 0.08)",
      lineHeight: 1.4,
      linkColor: computedColors.primary || "#6366f1",
      markerFontStyle: "9px",
      textBubble: computedColors.foreground || "#09090b",
      textDark: computedColors.foreground || "#09090b",
      textHeader: computedColors.mutedForeground || "#71717a",
      textHeaderSelected: "#ffffff",
      textLight: computedColors.mutedForeground || "#71717a",
      textMedium: computedColors.mutedForeground || "#71717a",
    }),
    [computedColors],
  );

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="flex w-64 flex-col border-r border-border bg-muted/30">
        {/* Sidebar Header */}
        <div className="border-b border-border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Icon className="size-4" icon="lucide:database" />
            KeyVal Studio
          </div>
        </div>

        {/* Search */}
        <div className="flex items-center gap-1 border-b border-border p-2">
          <Input
            className="h-8 text-sm"
            placeholder="Search..."
            value={prefixSearch}
            onChange={(e) => setPrefixSearch(e.target.value)}
          />
          <Button
            className="size-8 shrink-0"
            size="icon"
            title={t("entries.refresh")}
            variant="ghost"
            onClick={loadPrefixes}
          >
            <Icon
              className={cn("size-4", loadingPrefixes && "animate-spin")}
              icon={loadingPrefixes ? "lucide:loader-2" : "lucide:refresh-cw"}
            />
          </Button>
          <Button
            className="size-8 shrink-0"
            size="icon"
            title="Add record"
            variant="ghost"
            onClick={() => setAddDialog(true)}
          >
            <Icon className="size-4" icon="lucide:plus" />
          </Button>
        </div>

        {/* Prefix List */}
        <ScrollArea className="flex-1">
          <div className="p-1">
            {/* All entries option */}
            <button
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                selectedPrefix === "" && "bg-accent",
              )}
              type="button"
              onClick={() => setSelectedPrefix("")}
            >
              <div className="flex items-center gap-2">
                <Icon className="size-4 text-muted-foreground" icon="lucide:folder" />
                <span>(all)</span>
              </div>
              <span className="text-xs text-muted-foreground">{totalCount}</span>
            </button>

            <Separator className="my-1" />

            {loadingPrefixes ? (
              <div className="space-y-1 p-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton className="h-7 w-full" key={i} />
                ))}
              </div>
            ) : (
              filteredPrefixes.map((p) => (
                <button
                  key={p.prefix}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                    selectedPrefix === p.prefix && "bg-accent",
                  )}
                  type="button"
                  onClick={() => setSelectedPrefix(p.prefix)}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="size-4 text-muted-foreground" icon="lucide:table-2" />
                    <span className="truncate">{p.prefix}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{p.count}</span>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          {/* View toggles */}
          <div className="flex items-center rounded-md border border-border">
            <Button className="h-8 rounded-r-none" size="sm" variant="ghost">
              <Icon className="size-4" icon="lucide:table-2" />
            </Button>
            <Button className="h-8 rounded-l-none" disabled size="sm" variant="ghost">
              <Icon className="size-4" icon="lucide:rows-3" />
            </Button>
          </div>

          <Separator className="h-6" orientation="vertical" />

          {/* Navigation */}
          <Button
            className="h-8"
            disabled={currentPage === 0}
            size="sm"
            variant="ghost"
            onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
          >
            <Icon className="size-4" icon="lucide:chevron-left" />
          </Button>
          <Button
            className="h-8"
            disabled={currentPage >= totalPages - 1}
            size="sm"
            variant="ghost"
            onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            <Icon className="size-4" icon="lucide:chevron-right" />
          </Button>

          <Separator className="h-6" orientation="vertical" />

          {/* Delete selected */}
          {selectedCount > 0 && (
            <>
              <Button
                className="h-8"
                size="sm"
                variant="destructive"
                onClick={handleDeleteSelected}
              >
                <Icon className="size-4" icon="lucide:trash-2" />
                Delete ({selectedCount})
              </Button>
              <Separator className="h-6" orientation="vertical" />
            </>
          )}

          {/* Add record */}
          <Button className="h-8" size="sm" variant="default" onClick={() => setAddDialog(true)}>
            <Icon className="size-4" icon="lucide:plus" />
            Add record
          </Button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Stats */}
          <span className="text-sm text-muted-foreground">
            {paginatedEntries.length} rows • {queryTime}ms
          </span>

          <Separator className="h-6" orientation="vertical" />

          {/* Page size */}
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(0);
            }}
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={250}>250</option>
          </select>

          {/* Page indicator */}
          <span className="text-sm text-muted-foreground">
            {currentPage + 1} / {Math.max(1, totalPages)}
          </span>

          {/* Refresh */}
          <Button
            className="h-8"
            disabled={loading}
            size="sm"
            variant="ghost"
            onClick={loadEntries}
          >
            <Icon
              className={cn("size-4", loading && "animate-spin")}
              icon={loading ? "lucide:loader-2" : "lucide:refresh-cw"}
            />
          </Button>
        </div>

        {/* Grid */}
        <div ref={gridRef} className="flex-1 overflow-hidden">
          {(loading && entries.length === 0) || !colorsReady ? (
            <div className="flex flex-col gap-1 p-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton className="h-8 w-full" key={i} />
              ))}
            </div>
          ) : paginatedEntries.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
              <Icon className="mb-4 size-12" icon="lucide:database" />
              <p>{t("entries.noEntries")}</p>
            </div>
          ) : (
            <DataEditor
              columns={columns}
              getCellContent={getCellContent}
              gridSelection={selection}
              height={gridSize.height}
              rowMarkers="checkbox"
              rows={paginatedEntries.length}
              smoothScrollX
              smoothScrollY
              theme={theme}
              width={gridSize.width}
              onCellActivated={handleCellActivated}
              onCellEdited={handleCellEdited}
              onGridSelectionChange={setSelection}
            />
          )}
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog
        open={editDialog?.open ?? false}
        onOpenChange={(open: boolean) => !open && setEditDialog(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("entries.editValue")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("entries.key")}</Label>
              <code className="mt-1 block rounded bg-muted p-2 font-mono text-sm">
                {editDialog ? formatKey(editDialog.entry.key) : ""}
              </code>
            </div>
            <div>
              <Label htmlFor="edit-value">{t("entries.value")}</Label>
              <textarea
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              <Button variant="outline">{t("entries.cancel")}</Button>
            </DialogClose>
            <Button onClick={handleSaveEdit}>{t("entries.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog
        open={deleteDialog?.open ?? false}
        onOpenChange={(open: boolean) => !open && setDeleteDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("entries.confirmDeleteTitle")}</DialogTitle>
            <DialogDescription>
              {deleteDialog?.keys.length === 1
                ? t("entries.confirmDelete")
                : t("entries.confirmDeleteMultiple", { count: deleteDialog?.keys.length ?? 0 })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t("entries.cancel")}</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              {t("entries.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Record Dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("entries.set.title")}</DialogTitle>
            <DialogDescription>{t("entries.set.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("entries.set.keyLabel")}</Label>
              <Input
                className="mt-1 font-mono"
                placeholder="users/123 or posts/456"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
              />
            </div>
            <div>
              <Label>{t("entries.set.valueLabel")}</Label>
              <textarea
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder='{"name": "Alice"}'
                rows={8}
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t("entries.cancel")}</Button>
            </DialogClose>
            <Button disabled={!newKey} onClick={handleAddRecord}>
              {t("entries.set.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
