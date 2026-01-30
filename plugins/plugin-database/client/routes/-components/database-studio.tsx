import {
  type ColumnDef,
  type ColumnPinningState,
  type ColumnSizingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type Header,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Icon } from "~/components/ui/icon";
import { Input } from "~/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "~/components/ui/resizable";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { TooltipProvider } from "~/components/ui/tooltip";
import { cn } from "~/utils/cn";
import { api, type ColumnInfo, type TableInfo } from "../../helpers/api";
import { type CellVariant, cellRegistry, type DatabaseType, type RowHeight } from "./cell-variants";

// Column sizing configuration
const COLUMN_SIZE = {
  min: 80,
  max: 500,
  select: 40, // Fixed width for checkbox column
} as const;

// Row height options
const ROW_HEIGHT_CONFIG: Record<RowHeight, { label: string; height: number }> = {
  short: { label: "Short", height: 36 },
  medium: { label: "Medium", height: 48 },
  tall: { label: "Tall", height: 64 },
};

// Get column type icon based on SQL type
function getColumnTypeIcon(sqlType: string): string {
  const type = sqlType.toUpperCase();
  if (
    type.includes("INT") ||
    type.includes("REAL") ||
    type.includes("FLOAT") ||
    type.includes("DOUBLE") ||
    type.includes("NUMERIC") ||
    type.includes("DECIMAL")
  ) {
    return "lucide:hash";
  }
  if (type.includes("BOOL")) {
    return "lucide:check-square";
  }
  if (type.includes("DATE") || type.includes("TIME")) {
    return "lucide:calendar";
  }
  if (type.includes("BLOB")) {
    return "lucide:file";
  }
  return "lucide:baseline";
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

// Cell Content wrapper that renders the appropriate cell type
function CellContent({
  cellVariant,
  column,
  databaseType,
  isEditable,
  isFocused,
  isPending,
  rowHeight,
  value,
  onBlur,
  onClick,
  onKeyDown,
  onSave,
}: {
  cellVariant: CellVariant;
  column: ColumnInfo;
  databaseType: DatabaseType;
  isEditable: boolean;
  isFocused: boolean;
  isPending: boolean;
  rowHeight: RowHeight;
  value: unknown;
  onBlur: () => void;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSave: (newValue: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const cellRef = useRef<HTMLDivElement>(null);

  // Focus the cell element when it becomes focused
  useEffect(() => {
    if (isFocused && !isEditing) {
      cellRef.current?.focus();
    }
  }, [isFocused, isEditing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isEditing) {
      if (e.key === "Enter" || e.key === "F2") {
        e.preventDefault();
        if (isEditable && cellVariant !== "checkbox") {
          setIsEditing(true);
        }
      } else {
        onKeyDown(e);
      }
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    // e.detail contains the click count (1 = single, 2 = double, etc.)
    if (e.detail === 2) {
      // Double click - enter edit mode (don't call onClick to avoid re-render)
      e.preventDefault();
      e.stopPropagation();
      if (isEditable && cellVariant !== "checkbox") {
        setIsEditing(true);
      }
    } else {
      // Single click - just focus
      cellRef.current?.focus();
      onClick();
    }
  };

  const handleSave = (newValue: string) => {
    setIsEditing(false);
    onSave(newValue);
  };

  const handleBlur = () => {
    setIsEditing(false);
    onBlur();
  };

  // Get cell component from registry
  const variantConfig = cellRegistry.getVariant(cellVariant);
  const CellComponent = variantConfig?.component;

  // Convert API's ColumnInfo to cell-variants' ColumnInfo format
  const columnInfo = {
    name: column.name,
    nullable: column.nullable,
    pk: column.pk,
    type: column.type,
  };

  return (
    <div
      ref={cellRef}
      className={cn(
        "size-full cursor-default px-2 py-1.5 text-start text-sm outline-none",
        isFocused && "ring-1 ring-ring ring-inset",
        isEditable && !isEditing && "hover:bg-muted/50",
        isPending && "bg-amber-100 dark:bg-amber-900/30",
      )}
      role="button"
      tabIndex={isFocused ? 0 : -1}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {CellComponent ? (
        <CellComponent
          columnInfo={columnInfo}
          databaseType={databaseType}
          isEditable={isEditable}
          isEditing={isEditing}
          rowHeight={rowHeight}
          value={value}
          onBlur={handleBlur}
          onSave={handleSave}
        />
      ) : (
        <span className="text-muted-foreground">Unknown variant: {cellVariant}</span>
      )}
    </div>
  );
}

// Column Header with dropdown menu
function ColumnHeader({
  column,
  isPinned,
  sortDirection,
  onHide,
  onPin,
  onSort,
}: {
  column: ColumnInfo;
  isPinned: "left" | "right" | false;
  sortDirection: "asc" | "desc" | false;
  onHide: () => void;
  onPin: (position: "left" | "right" | false) => void;
  onSort: (direction: "asc" | "desc" | false) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex size-full items-center justify-between gap-1 px-2 text-xs font-medium text-muted-foreground hover:bg-accent/40 data-[state=open]:bg-accent/40 outline-none">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon
            className="size-3.5 shrink-0 text-muted-foreground"
            icon={getColumnTypeIcon(column.type)}
          />
          <span className="truncate">{column.name}</span>
          {column.pk && <Icon className="size-3 text-amber-500 shrink-0" icon="lucide:key" />}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {sortDirection === "asc" && <Icon className="size-3" icon="lucide:chevron-up" />}
          {sortDirection === "desc" && <Icon className="size-3" icon="lucide:chevron-down" />}
          {!sortDirection && (
            <Icon className="size-3 text-muted-foreground/50" icon="lucide:chevron-down" />
          )}
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={0} className="w-40">
        <DropdownMenuItem onClick={() => onSort(sortDirection === "asc" ? false : "asc")}>
          <Icon className="size-4" icon="lucide:arrow-up" />
          Sort asc
          {sortDirection === "asc" && <Icon className="size-3 ml-auto" icon="lucide:check" />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSort(sortDirection === "desc" ? false : "desc")}>
          <Icon className="size-4" icon="lucide:arrow-down" />
          Sort desc
          {sortDirection === "desc" && <Icon className="size-3 ml-auto" icon="lucide:check" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {isPinned === "left" ? (
          <DropdownMenuItem onClick={() => onPin(false)}>
            <Icon className="size-4" icon="lucide:pin-off" />
            Unpin from left
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => onPin("left")}>
            <Icon className="size-4" icon="lucide:pin" />
            Pin to left
          </DropdownMenuItem>
        )}
        {isPinned === "right" ? (
          <DropdownMenuItem onClick={() => onPin(false)}>
            <Icon className="size-4" icon="lucide:pin-off" />
            Unpin from right
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => onPin("right")}>
            <Icon className="size-4" icon="lucide:pin" />
            Pin to right
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onHide}>
          <Icon className="size-4" icon="lucide:eye-off" />
          Hide column
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Column Resizer for drag-to-resize columns
function ColumnResizer<TData>({ header }: { header: Header<TData, unknown> }) {
  if (!header.column.getCanResize()) {
    return null;
  }

  return (
    <div
      aria-label={`Resize ${header.column.id} column`}
      aria-orientation="vertical"
      aria-valuemax={COLUMN_SIZE.max}
      aria-valuemin={COLUMN_SIZE.min}
      aria-valuenow={header.column.getSize()}
      className={cn(
        "absolute -right-px top-0 z-10 h-full w-1 cursor-ew-resize touch-none select-none bg-transparent transition-colors hover:bg-primary",
        header.column.getIsResizing() && "bg-primary",
      )}
      role="separator"
      onDoubleClick={() => header.column.resetSize()}
      onMouseDown={header.getResizeHandler()}
      onTouchStart={header.getResizeHandler()}
    />
  );
}

// Column Visibility Popover with search
function ColumnVisibilityPopover({
  columnVisibility,
  columns,
  hiddenColumnCount,
  onColumnVisibilityChange,
}: {
  columnVisibility: VisibilityState;
  columns: ColumnInfo[];
  hiddenColumnCount: number;
  onColumnVisibilityChange: (visibility: VisibilityState) => void;
}) {
  const [search, setSearch] = useState("");

  const filteredColumns = useMemo(() => {
    if (!search) return columns;
    const lower = search.toLowerCase();
    return columns.filter((col) => col.name.toLowerCase().includes(lower));
  }, [columns, search]);

  const visibleCount = columns.filter((col) => columnVisibility[col.name] !== false).length;

  const handleToggleColumn = (colName: string) => {
    const isCurrentlyVisible = columnVisibility[colName] !== false;
    // Prevent hiding the last visible column
    if (isCurrentlyVisible && visibleCount <= 1) {
      return;
    }
    onColumnVisibilityChange({
      ...columnVisibility,
      [colName]: !isCurrentlyVisible,
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button className="h-7 text-xs gap-1" size="sm" variant="outline">
          <Icon className="size-3" icon="lucide:columns-3" />
          View
          {hiddenColumnCount > 0 && (
            <Badge variant="secondary" className="ml-1 px-1 py-0 text-[10px]">
              {hiddenColumnCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-medium">Toggle columns</span>
          {hiddenColumnCount > 0 && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              type="button"
              onClick={() => onColumnVisibilityChange({})}
            >
              Reset
            </button>
          )}
        </div>

        {/* Search input */}
        <div className="border-b p-2">
          <div className="relative">
            <Icon
              className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              icon="lucide:search"
            />
            <Input
              className="h-8 pl-7 text-sm"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Column list */}
        <div className="max-h-64 overflow-auto p-1">
          {filteredColumns.length === 0 ? (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              No columns found
            </div>
          ) : (
            filteredColumns.map((col) => {
              const isVisible = columnVisibility[col.name] !== false;
              const isLastVisible = isVisible && visibleCount <= 1;
              return (
                <button
                  key={col.name}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent cursor-pointer text-left",
                    isLastVisible && "opacity-50 cursor-not-allowed",
                  )}
                  disabled={isLastVisible}
                  type="button"
                  onClick={() => handleToggleColumn(col.name)}
                >
                  <Checkbox checked={isVisible} disabled={isLastVisible} tabIndex={-1} />
                  <span className="truncate">{col.name}</span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function DatabaseStudio() {
  // Sidebar state
  const [loadingTables, setLoadingTables] = useState(false);
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [tableSearch, setTableSearch] = useState("");

  // Grid state
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({
    left: ["select"],
    right: [],
  });
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [focusedCell, setFocusedCell] = useState<{ columnId: string; rowIndex: number } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [rowHeight, setRowHeight] = useState<RowHeight>("short");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});

  // Draft mode - pending changes tracking
  // Map<rowId, Map<columnName, newValue>>
  const [pendingChanges, setPendingChanges] = useState<Map<string, Map<string, unknown>>>(
    new Map(),
  );
  const [isSaving, setIsSaving] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [queryTime, setQueryTime] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  // Database type (for cell variant selection)
  const [databaseType, _setDatabaseType] = useState<DatabaseType>("sqlite");

  const gridRef = useRef<HTMLDivElement>(null);

  // Get row ID for tracking changes
  const getRowId = useCallback(
    (rowData: Record<string, unknown>, index: number): string => {
      const pkColumn = columns.find((c) => c.pk);
      return pkColumn ? String(rowData[pkColumn.name]) : String(index);
    },
    [columns],
  );

  // Check if a cell has pending changes
  const hasPendingChange = useCallback(
    (rowId: string, columnName: string): boolean => {
      return pendingChanges.get(rowId)?.has(columnName) ?? false;
    },
    [pendingChanges],
  );

  // Get the display value (pending or original)
  const getCellValue = useCallback(
    (rowData: Record<string, unknown>, rowId: string, columnName: string): unknown => {
      const rowChanges = pendingChanges.get(rowId);
      if (rowChanges?.has(columnName)) {
        return rowChanges.get(columnName);
      }
      return rowData[columnName];
    },
    [pendingChanges],
  );

  const hasPendingChanges = pendingChanges.size > 0;
  const pendingChangeCount = useMemo(() => {
    let count = 0;
    for (const rowChanges of pendingChanges.values()) {
      count += rowChanges.size;
    }
    return count;
  }, [pendingChanges]);

  // Load tables
  const loadTables = useCallback(async () => {
    setLoadingTables(true);
    try {
      const result = await api.getTables();
      setTables(result.tables);
    } catch (error) {
      console.error("Failed to load tables:", error);
    } finally {
      setLoadingTables(false);
    }
  }, []);

  // Load table data
  const loadTableData = useCallback(async () => {
    if (!selectedTable) return;

    setLoading(true);
    const startTime = performance.now();
    try {
      const [schemaResult, rowsResult] = await Promise.all([
        api.getTableSchema(selectedTable),
        api.getTableRows(selectedTable, {
          limit: pageSize,
          offset: currentPage * pageSize,
        }),
      ]);

      setColumns(schemaResult.columns);
      setRows(rowsResult.rows);
      setTotalCount(rowsResult.total);
      setQueryTime(Math.round(performance.now() - startTime));
    } catch (error) {
      console.error("Failed to load table data:", error);
    } finally {
      setLoading(false);
    }
  }, [currentPage, pageSize, selectedTable]);

  // Handle add row
  const handleAddRow = useCallback(async () => {
    if (!selectedTable || columns.length === 0) return;

    // Get column names (excluding auto-increment primary key)
    const insertColumns = columns.filter((c) => !c.pk);
    if (insertColumns.length === 0) {
      console.warn("No insertable columns found");
      return;
    }

    // Create default values for each column
    const defaultValues = insertColumns.map((col) => {
      const type = col.type.toUpperCase();
      if (
        type.includes("INT") ||
        type.includes("REAL") ||
        type.includes("FLOAT") ||
        type.includes("DOUBLE") ||
        type.includes("NUMERIC")
      ) {
        return "0";
      }
      if (type.includes("BOOL")) {
        return "0";
      }
      return "''";
    });

    const columnNames = insertColumns.map((c) => `"${c.name}"`).join(", ");
    const values = defaultValues.join(", ");
    const sql = `INSERT INTO "${selectedTable}" (${columnNames}) VALUES (${values})`;

    try {
      await api.executeQuery(sql);
      await loadTableData();
    } catch (error) {
      console.error("Failed to add row:", error);
    }
  }, [columns, loadTableData, selectedTable]);

  // Handle cell edit - store in pending changes (draft mode)
  const handleCellEdit = useCallback(
    (rowIndex: number, columnId: string, newValue: string) => {
      const rowData = rows[rowIndex];
      const column = columns.find((c) => c.name === columnId);
      if (!rowData || !column || column.pk) {
        return;
      }

      const rowId = getRowId(rowData, rowIndex);
      const originalValue = formatCellValue(rowData[columnId]);

      // Determine if value should be NULL
      const finalValue = newValue === "" ? null : newValue;

      // Check if we're reverting to original value
      if (newValue === originalValue) {
        // Remove from pending changes
        setPendingChanges((prev) => {
          const newMap = new Map(prev);
          const rowChanges = newMap.get(rowId);
          if (rowChanges) {
            rowChanges.delete(columnId);
            if (rowChanges.size === 0) {
              newMap.delete(rowId);
            }
          }
          return newMap;
        });
        return;
      }

      // Add to pending changes
      setPendingChanges((prev) => {
        const newMap = new Map(prev);
        const rowChanges = newMap.get(rowId) ?? new Map<string, unknown>();
        rowChanges.set(columnId, finalValue);
        newMap.set(rowId, rowChanges);
        return newMap;
      });
    },
    [columns, getRowId, rows],
  );

  // Save all pending changes
  const handleSaveChanges = useCallback(async () => {
    if (pendingChanges.size === 0) return;

    const pkColumn = columns.find((c) => c.pk);
    if (!pkColumn) {
      console.warn("No primary key found, cannot update");
      return;
    }

    setIsSaving(true);
    try {
      // Build and execute UPDATE statements for each row
      for (const [rowId, rowChanges] of pendingChanges) {
        for (const [columnName, newValue] of rowChanges) {
          const escapedValue =
            newValue === null
              ? "NULL"
              : typeof newValue === "string"
                ? `'${newValue.replace(/'/g, "''")}'`
                : newValue;
          const escapedPkValue =
            typeof rowId === "string" && Number.isNaN(Number(rowId))
              ? `'${rowId.replace(/'/g, "''")}'`
              : rowId;

          const sql = `UPDATE "${selectedTable}" SET "${columnName}" = ${escapedValue} WHERE "${pkColumn.name}" = ${escapedPkValue}`;
          await api.executeQuery(sql);
        }
      }

      // Apply pending changes to rows optimistically to avoid flash
      setRows((prev) => {
        const updated = [...prev];
        for (const [rowId, rowChanges] of pendingChanges) {
          const rowIndex = updated.findIndex((r) => getRowId(r, 0) === rowId);
          if (rowIndex !== -1) {
            for (const [columnName, newValue] of rowChanges) {
              updated[rowIndex] = { ...updated[rowIndex], [columnName]: newValue };
            }
          }
        }
        return updated;
      });

      // Clear pending changes (no flash because rows already have new values)
      setPendingChanges(new Map());
    } catch (error) {
      console.error("Failed to save changes:", error);
    } finally {
      setIsSaving(false);
    }
  }, [columns, getRowId, pendingChanges, selectedTable]);

  // Discard all pending changes
  const handleDiscardChanges = useCallback(() => {
    setPendingChanges(new Map());
  }, []);

  // Keyboard navigation
  const handleCellKeyDown = useCallback(
    (e: React.KeyboardEvent, rowIndex: number, columnId: string) => {
      const colIndex = columns.findIndex((c) => c.name === columnId);
      if (colIndex === -1) return;

      let nextRowIndex = rowIndex;
      let nextColIndex = colIndex;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          nextRowIndex = Math.max(0, rowIndex - 1);
          break;
        case "ArrowDown":
          e.preventDefault();
          nextRowIndex = Math.min(rows.length - 1, rowIndex + 1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          nextColIndex = Math.max(0, colIndex - 1);
          break;
        case "ArrowRight":
          e.preventDefault();
          nextColIndex = Math.min(columns.length - 1, colIndex + 1);
          break;
        case "Tab":
          e.preventDefault();
          if (e.shiftKey) {
            nextColIndex = colIndex - 1;
            if (nextColIndex < 0) {
              nextColIndex = columns.length - 1;
              nextRowIndex = Math.max(0, rowIndex - 1);
            }
          } else {
            nextColIndex = colIndex + 1;
            if (nextColIndex >= columns.length) {
              nextColIndex = 0;
              nextRowIndex = Math.min(rows.length - 1, rowIndex + 1);
            }
          }
          break;
        default:
          return;
      }

      const nextColumnId = columns[nextColIndex]?.name;
      if (nextColumnId) {
        setFocusedCell({ columnId: nextColumnId, rowIndex: nextRowIndex });
      }
    },
    [columns, rows.length],
  );

  // Initial load
  useEffect(() => {
    loadTables();
  }, [loadTables]);

  // Load table data when selection or pagination changes
  useEffect(() => {
    if (selectedTable) {
      loadTableData();
    }
  }, [loadTableData, selectedTable]);

  // Reset focus, selection, and pending changes when table changes
  useEffect(() => {
    setFocusedCell(null);
    setRowSelection({});
    setSorting([]);
    setColumnVisibility({});
    setColumnPinning({ left: ["select"], right: [] });
    setColumnSizing({});
    setPendingChanges(new Map());
  }, [selectedTable]);

  const totalPages = Math.ceil(totalCount / pageSize);

  // Default column sizes
  const defaultColumnSizes = useMemo(() => {
    const sizes: Record<string, number> = {};
    sizes.select = COLUMN_SIZE.select;
    for (const col of columns) {
      // Calculate based on column name/type length, respecting min/max
      const calculated = (col.name.length + col.type.length) * 8 + 60;
      sizes[col.name] = Math.max(COLUMN_SIZE.min, Math.min(COLUMN_SIZE.max, calculated));
    }
    return sizes;
  }, [columns]);

  // Generate TanStack Table columns from schema
  const tableColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    const selectColumn: ColumnDef<Record<string, unknown>> = {
      id: "select",
      header: ({ table }) => (
        <div className="flex h-full items-center justify-center">
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            aria-label="Select all"
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          />
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex h-full items-center justify-center">
          <Checkbox
            checked={row.getIsSelected()}
            aria-label="Select row"
            onCheckedChange={(value) => row.toggleSelected(!!value)}
          />
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
      enablePinning: false,
      enableResizing: false,
    };

    const dataColumns: ColumnDef<Record<string, unknown>>[] = columns.map((col) => ({
      accessorKey: col.name,
      cell: ({ row }) => {
        const rowIndex = row.index;
        const rowId = getRowId(row.original, rowIndex);
        const value = getCellValue(row.original, rowId, col.name);
        const isFocused = focusedCell?.rowIndex === rowIndex && focusedCell?.columnId === col.name;
        const isPending = hasPendingChange(rowId, col.name);
        const cellVariant = cellRegistry.mapTypeToVariant(databaseType, col.type);

        return (
          <CellContent
            cellVariant={cellVariant}
            column={col}
            databaseType={databaseType}
            isEditable={!col.pk}
            isFocused={isFocused}
            isPending={isPending}
            rowHeight={rowHeight}
            value={value}
            onBlur={() => {
              // Keep focus state for navigation
            }}
            onClick={() => setFocusedCell({ columnId: col.name, rowIndex })}
            onKeyDown={(e) => handleCellKeyDown(e, rowIndex, col.name)}
            onSave={(newValue) => handleCellEdit(rowIndex, col.name, newValue)}
          />
        );
      },
      header: ({ column }) => {
        const sortDirection = column.getIsSorted();
        const isPinned = column.getIsPinned();
        return (
          <ColumnHeader
            column={col}
            isPinned={isPinned}
            sortDirection={sortDirection}
            onHide={() => column.toggleVisibility(false)}
            onPin={(position) => column.pin(position)}
            onSort={(direction) => {
              if (direction === false) {
                column.clearSorting();
              } else {
                column.toggleSorting(direction === "desc");
              }
            }}
          />
        );
      },
      id: col.name,
      enableSorting: true,
      enableHiding: true,
      enablePinning: true,
    }));

    return [selectColumn, ...dataColumns];
  }, [
    columns,
    databaseType,
    focusedCell,
    getCellValue,
    getRowId,
    handleCellEdit,
    handleCellKeyDown,
    hasPendingChange,
    rowHeight,
  ]);

  const table = useReactTable({
    columnResizeMode: "onChange",
    columns: tableColumns,
    data: rows,
    defaultColumn: {
      minSize: COLUMN_SIZE.min,
      maxSize: COLUMN_SIZE.max,
    },
    enableColumnPinning: true,
    enableColumnResizing: true,
    enableRowSelection: true,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row, index) => {
      const pkColumn = columns.find((c) => c.pk);
      return pkColumn ? String(row[pkColumn.name]) : String(index);
    },
    getSortedRowModel: getSortedRowModel(),
    onColumnPinningChange: setColumnPinning,
    onColumnSizingChange: setColumnSizing,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    state: {
      columnPinning,
      columnSizing,
      columnVisibility,
      rowSelection,
      sorting,
    },
  });

  // Generate column size CSS variables from table state
  const columnSizeVars = useMemo(() => {
    const vars: Record<string, string> = {};
    for (const header of table.getFlatHeaders()) {
      // Select column has fixed width
      if (header.id === "select") {
        vars[`--col-${header.id}-size`] = `${COLUMN_SIZE.select}`;
        continue;
      }
      // Clamp size to min/max to ensure constraints are respected
      const rawSize = columnSizing[header.id] ?? defaultColumnSizes[header.id] ?? 150;
      const size = Math.max(COLUMN_SIZE.min, Math.min(COLUMN_SIZE.max, rawSize));
      vars[`--col-${header.id}-size`] = `${size}`;
    }
    return vars;
  }, [columnSizing, defaultColumnSizes, table]);

  const filteredTables = useMemo(() => {
    if (!tableSearch) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(tableSearch.toLowerCase()));
  }, [tableSearch, tables]);

  const selectedRowCount = Object.keys(rowSelection).length;
  const hiddenColumnCount = Object.values(columnVisibility).filter((v) => v === false).length;
  const currentRowHeight = ROW_HEIGHT_CONFIG[rowHeight];

  return (
    <TooltipProvider>
      <ResizablePanelGroup className="h-full" direction="horizontal">
        {/* Sidebar */}
        <ResizablePanel defaultSize={20} maxSize={40} minSize={15}>
          <div className="flex h-full flex-col bg-muted/30">
            {/* Sidebar Header */}
            <div className="border-b border-border p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Icon className="size-4" icon="lucide:database" />
                Database Studio
              </div>
            </div>

            {/* Search */}
            <div className="flex items-center gap-1 border-b border-border p-2">
              <Input
                className="h-8 text-sm"
                placeholder="Search tables..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
              />
              <Button
                className="size-8 shrink-0"
                size="icon"
                title="Refresh"
                variant="ghost"
                onClick={loadTables}
              >
                <Icon
                  className={cn("size-4", loadingTables && "animate-spin")}
                  icon={loadingTables ? "lucide:loader-2" : "lucide:refresh-cw"}
                />
              </Button>
            </div>

            {/* Tables List */}
            <ScrollArea className="flex-1">
              <div className="p-1">
                {loadingTables ? (
                  <div className="space-y-1 p-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton className="h-7 w-full" key={i} />
                    ))}
                  </div>
                ) : filteredTables.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    No tables found
                  </div>
                ) : (
                  filteredTables.map((t) => (
                    <button
                      key={t.name}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                        selectedTable === t.name && "bg-accent",
                      )}
                      type="button"
                      onClick={() => {
                        setSelectedTable(t.name);
                        setCurrentPage(0);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <Icon
                          className="size-4 text-muted-foreground"
                          icon={t.type === "view" ? "lucide:eye" : "lucide:table-2"}
                        />
                        <span className="truncate">{t.name}</span>
                      </div>
                      {t.type === "view" && (
                        <Badge className="text-[10px] px-1.5 py-0" variant="outline">
                          view
                        </Badge>
                      )}
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        {/* Main Content */}
        <ResizablePanel defaultSize={80}>
          <div className="flex h-full flex-col">
            {/* Toolbar */}
            <div className="flex h-10 items-center gap-2 border-b border-border px-3">
              {/* Table name */}
              {selectedTable && (
                <>
                  <div className="flex items-center gap-2">
                    <Icon className="size-4 text-muted-foreground" icon="lucide:table-2" />
                    <span className="font-medium text-sm">{selectedTable}</span>
                  </div>
                  <div className="h-4 w-px bg-border" />
                </>
              )}

              {/* Draft mode - Save/Discard buttons */}
              {hasPendingChanges && (
                <>
                  <Button
                    className="h-7 text-xs gap-1"
                    disabled={isSaving}
                    size="sm"
                    variant="default"
                    onClick={handleSaveChanges}
                  >
                    {isSaving ? (
                      <Icon className="size-3 animate-spin" icon="lucide:loader-2" />
                    ) : (
                      <Icon className="size-3" icon="lucide:check" />
                    )}
                    Save
                    <Badge
                      variant="secondary"
                      className="ml-1 px-1 py-0 text-[10px] bg-primary-foreground/20"
                    >
                      {pendingChangeCount}
                    </Badge>
                  </Button>
                  <Button
                    className="h-7 text-xs gap-1"
                    disabled={isSaving}
                    size="sm"
                    variant="ghost"
                    onClick={handleDiscardChanges}
                  >
                    Discard
                  </Button>
                  <div className="h-4 w-px bg-border" />
                </>
              )}

              {/* Spacer */}
              <div className="flex-1" />

              {/* Toolbar buttons */}
              {selectedTable && (
                <>
                  {/* Add row button */}
                  <Button
                    className="h-7 text-xs gap-1"
                    disabled={!selectedTable || isSaving}
                    size="sm"
                    variant="outline"
                    onClick={handleAddRow}
                  >
                    <Icon className="size-3" icon="lucide:plus" />
                    Add row
                  </Button>

                  <div className="h-4 w-px bg-border" />

                  {/* Sort button */}
                  <Button
                    className="h-7 text-xs gap-1"
                    disabled={sorting.length === 0}
                    size="sm"
                    variant="outline"
                    onClick={() => setSorting([])}
                  >
                    <Icon className="size-3" icon="lucide:arrow-up-down" />
                    Sort
                    {sorting.length > 0 && (
                      <Badge variant="secondary" className="ml-1 px-1 py-0 text-[10px]">
                        {sorting.length}
                      </Badge>
                    )}
                  </Button>

                  {/* Row height selector */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button className="h-7 text-xs gap-1" size="sm" variant="outline">
                        <Icon className="size-3" icon="lucide:rows-3" />
                        {currentRowHeight.label}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-32 p-1">
                      {(Object.keys(ROW_HEIGHT_CONFIG) as RowHeight[]).map((height) => (
                        <button
                          key={height}
                          className={cn(
                            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent",
                            rowHeight === height && "bg-accent",
                          )}
                          type="button"
                          onClick={() => setRowHeight(height)}
                        >
                          {ROW_HEIGHT_CONFIG[height].label}
                        </button>
                      ))}
                    </PopoverContent>
                  </Popover>

                  {/* View (column visibility) */}
                  <ColumnVisibilityPopover
                    columnVisibility={columnVisibility}
                    columns={columns}
                    hiddenColumnCount={hiddenColumnCount}
                    onColumnVisibilityChange={setColumnVisibility}
                  />

                  {/* Refresh */}
                  <Button
                    className="size-7"
                    disabled={loading}
                    size="icon"
                    variant="ghost"
                    onClick={loadTableData}
                  >
                    <Icon
                      className={cn("size-4", loading && "animate-spin")}
                      icon={loading ? "lucide:loader-2" : "lucide:refresh-cw"}
                    />
                  </Button>
                </>
              )}
            </div>

            {/* Grid */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
              {!selectedTable ? (
                <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                  <Icon className="mb-4 size-12 opacity-20" icon="lucide:table-2" />
                  <p className="text-sm">Select a table to view data</p>
                </div>
              ) : loading && rows.length === 0 ? (
                <div className="flex flex-col gap-0.5 p-0.5">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <Skeleton className="h-9 w-full" key={i} />
                  ))}
                </div>
              ) : rows.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                  <Icon className="mb-4 size-12 opacity-20" icon="lucide:inbox" />
                  <p className="text-sm">No rows in this table</p>
                  <p className="mt-1 text-xs">Click &quot;Add row&quot; to create one</p>
                </div>
              ) : (
                <div
                  ref={gridRef}
                  aria-colcount={columns.length + 1}
                  aria-label="Data grid"
                  aria-rowcount={rows.length}
                  className="min-h-0 flex-1 select-none rounded-md border border-border focus:outline-none overflow-auto"
                  role="grid"
                  style={columnSizeVars}
                  tabIndex={0}
                >
                  {/* Header - sticky at top */}
                  <div
                    className="sticky top-0 z-10 flex w-fit min-w-full border-b border-border bg-muted/50"
                    role="row"
                  >
                    {table.getHeaderGroups()[0]?.headers.map((header) => (
                      <div
                        key={header.id}
                        className={cn(
                          "relative flex h-8 shrink-0 items-center border-r border-border/50 bg-muted/50",
                          header.id === "select" && "justify-center",
                        )}
                        role="columnheader"
                        style={{
                          width: `calc(var(--col-${header.column.id}-size) * 1px)`,
                          minWidth: `calc(var(--col-${header.column.id}-size) * 1px)`,
                        }}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                        <ColumnResizer header={header} />
                      </div>
                    ))}
                    {/* Filler to extend background */}
                    <div className="flex-1 bg-muted/50" />
                  </div>

                  {/* Body */}
                  <div role="rowgroup">
                    {table.getRowModel().rows.map((row) => (
                      <div
                        key={row.id}
                        className={cn(
                          "flex w-fit min-w-full border-b border-border/50 last:border-b-0 hover:bg-muted/30",
                          row.getIsSelected() && "bg-primary/5",
                        )}
                        role="row"
                      >
                        {row.getVisibleCells().map((cell) => (
                          <div
                            key={cell.id}
                            className={cn(
                              "shrink-0 border-r border-border/50",
                              cell.column.id === "select" && "flex items-center justify-center",
                            )}
                            role="gridcell"
                            style={{
                              width: `calc(var(--col-${cell.column.id}-size) * 1px)`,
                              minWidth: `calc(var(--col-${cell.column.id}-size) * 1px)`,
                              height: `${currentRowHeight.height}px`,
                            }}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </div>
                        ))}
                        {/* Filler to extend row background */}
                        <div className="flex-1" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer - Pagination */}
            {selectedTable && rows.length > 0 && (
              <div className="flex h-10 items-center justify-between border-t border-border px-3">
                <span className="text-xs text-muted-foreground">
                  {selectedRowCount > 0 ? `${selectedRowCount} selected · ` : ""}
                  {rows.length} of {totalCount} rows
                  {queryTime > 0 && ` · ${queryTime}ms`}
                </span>

                <div className="flex items-center gap-2">
                  {/* Page size */}
                  <Select
                    value={String(pageSize)}
                    onValueChange={(value) => {
                      setPageSize(Number(value));
                      setCurrentPage(0);
                    }}
                  >
                    <SelectTrigger className="w-16" size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="250">250</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Navigation */}
                  <div className="flex items-center gap-1">
                    <Button
                      className="size-7"
                      disabled={currentPage === 0}
                      size="icon"
                      variant="ghost"
                      onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                    >
                      <Icon className="size-4" icon="lucide:chevron-left" />
                    </Button>
                    <span className="text-xs text-muted-foreground min-w-[60px] text-center">
                      {currentPage + 1} / {Math.max(1, totalPages)}
                    </span>
                    <Button
                      className="size-7"
                      disabled={currentPage >= totalPages - 1}
                      size="icon"
                      variant="ghost"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                    >
                      <Icon className="size-4" icon="lucide:chevron-right" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </TooltipProvider>
  );
}
