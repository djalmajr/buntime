import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import { useEffect, useRef, useState } from "react";
import {
  type ProxyRule,
  useCreateProxyRule,
  useDeleteProxyRule,
  useProxyRules,
  useReorderProxyRules,
  useToggleProxyRule,
  useUpdateProxyRule,
} from "~/hooks/use-proxy-rules";
import { type RedirectData, RedirectDrawer } from "./redirect-drawer";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Icon } from "./ui/icon";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface SortableRowProps {
  index: number;
  redirect: ProxyRule;
  onDelete: (redirect: ProxyRule) => void;
  onEdit: (redirect: ProxyRule) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onToggle: (id: string) => void;
}

function SortableRow({ index, redirect, onDelete, onEdit, onMove, onToggle }: SortableRowProps) {
  const dragHandleRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLTableRowElement>(null);
  const [isDraggedOver, setIsDraggedOver] = useState(false);

  useEffect(() => {
    const handle = dragHandleRef.current;
    const element = rowRef.current;

    if (!handle || !element) return;

    const cleanupDraggable = draggable({
      element: handle,
      getInitialData: () => ({ index }),
      onGenerateDragPreview: ({ nativeSetDragImage }) => {
        setCustomNativeDragPreview({
          nativeSetDragImage,
          getOffset: () => ({ x: 16, y: 16 }),
          render: ({ container }) => {
            const table = element.closest("table");
            if (!table) return;

            const rect = element.getBoundingClientRect();
            const tableClone = table.cloneNode(false) as HTMLElement;
            const tbodyClone = document.createElement("tbody");
            const rowClone = element.cloneNode(true) as HTMLElement;

            // Sync column widths from original cells
            const originalCells = element.querySelectorAll("td");
            const clonedCells = rowClone.querySelectorAll("td");
            for (let i = 0; i < originalCells.length; i++) {
              const w = originalCells[i]!.getBoundingClientRect().width;
              (clonedCells[i] as HTMLElement).style.width = `${w}px`;
            }

            tbodyClone.appendChild(rowClone);
            tableClone.appendChild(tbodyClone);

            tableClone.style.width = `${rect.width}px`;
            tableClone.style.borderRadius = "6px";
            tableClone.style.overflow = "hidden";
            tableClone.style.boxShadow =
              "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)";
            tableClone.style.border = "1px solid var(--border, #e5e7eb)";
            tableClone.style.backgroundColor = "var(--background, white)";

            container.appendChild(tableClone);
          },
        });
      },
      onDragStart: () => {
        element.style.opacity = "0.4";
      },
      onDrop: () => {
        element.style.opacity = "1";
      },
    });

    const cleanupDropTarget = dropTargetForElements({
      element,
      getData: () => ({ index }),
      onDragEnter: () => {
        setIsDraggedOver(true);
      },
      onDragLeave: () => {
        setIsDraggedOver(false);
      },
      onDrop: ({ source }) => {
        setIsDraggedOver(false);
        const sourceIndex = source.data.index;
        if (typeof sourceIndex === "number" && sourceIndex !== index) {
          onMove(sourceIndex, index);
        }
      },
    });

    return () => {
      cleanupDraggable();
      cleanupDropTarget();
    };
  }, [index, onMove]);

  const isDisabled = redirect.enabled === false;

  return (
    <TableRow
      ref={rowRef}
      className={isDraggedOver ? "bg-primary/5 border-primary/30" : undefined}
    >
      <TableCell className="w-8 px-2 align-middle">
        <div
          ref={dragHandleRef}
          className="flex items-center justify-center cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
        >
          <Icon className="size-4" icon="lucide:grip-vertical" />
        </div>
      </TableCell>
      <TableCell>
        <span className="font-medium">{redirect.name || redirect.pattern}</span>
      </TableCell>
      <TableCell>
        <code className="rounded bg-muted px-1.5 py-0.5">{redirect.pattern}</code>
      </TableCell>
      <TableCell>
        <span className="max-w-[200px] truncate">{redirect.target}</span>
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="size-8"
                size="icon"
                variant="ghost"
                onClick={() => onToggle(redirect.id)}
              >
                <Icon
                  className="size-4.5"
                  icon={isDisabled ? "lucide:eye-off" : "lucide:eye"}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isDisabled ? "Enable" : "Disable"}</TooltipContent>
          </Tooltip>
          <Button
            className="size-8"
            size="icon"
            variant="ghost"
            onClick={() => onEdit(redirect)}
          >
            <Icon className="size-4.5" icon="lucide:pencil" />
          </Button>
          <Button
            className="size-8"
            size="icon"
            variant="ghost"
            onClick={() => onDelete(redirect)}
          >
            <Icon className="size-4.5" icon="lucide:trash-2" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function RedirectsPage() {
  const [deleteTarget, setDeleteTarget] = useState<ProxyRule | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRedirect, setEditingRedirect] = useState<ProxyRule | null>(null);

  const rules$ = useProxyRules();
  const create$ = useCreateProxyRule();
  const update$ = useUpdateProxyRule();
  const delete$ = useDeleteProxyRule();
  const toggle$ = useToggleProxyRule();
  const reorder$ = useReorderProxyRules();

  const redirects = rules$.data ?? [];
  const staticRedirects = redirects.filter((r) => r.readonly);
  const dynamicRedirects = redirects.filter((r) => !r.readonly);

  const handleAddClick = () => {
    setEditingRedirect(null);
    setDrawerOpen(true);
  };

  const handleEditClick = (redirect: ProxyRule) => {
    setEditingRedirect(redirect);
    setDrawerOpen(true);
  };

  const handleDeleteClick = (redirect: ProxyRule) => {
    setDeleteTarget(redirect);
  };

  const handleDeleteConfirm = () => {
    if (deleteTarget) {
      delete$.mutate(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  const handleSave = (data: RedirectData) => {
    if (editingRedirect) {
      update$.mutate({ data, id: editingRedirect.id });
    } else {
      create$.mutate(data);
    }
  };

  const handleMove = (fromIndex: number, toIndex: number) => {
    const ids = dynamicRedirects.map((r) => r.id);
    const [removed] = ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, removed!);
    reorder$.mutate(ids);
  };

  const renderStaticRow = (redirect: ProxyRule) => {
    const deleteButton = (
      <Button
        className="size-8"
        disabled
        size="icon"
        variant="ghost"
        onClick={() => handleDeleteClick(redirect)}
      >
        <Icon className="size-4.5" icon="lucide:trash-2" />
      </Button>
    );

    return (
      <TableRow key={redirect.id}>
        <TableCell className="w-8 px-2" />
        <TableCell>
          <div className="flex items-center gap-2">
            <span className="font-medium">{redirect.name || redirect.pattern}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              Fixed
            </span>
          </div>
        </TableCell>
        <TableCell>
          <code className="rounded bg-muted px-1.5 py-0.5">{redirect.pattern}</code>
        </TableCell>
        <TableCell>
          <span className="max-w-[200px] truncate">{redirect.target}</span>
        </TableCell>
        <TableCell>
          <div className="flex items-center justify-end gap-1">
            <Button
              className="size-8"
              size="icon"
              variant="ghost"
              onClick={() => handleEditClick(redirect)}
            >
              <Icon className="size-4.5" icon="lucide:eye" />
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-not-allowed">{deleteButton}</span>
              </TooltipTrigger>
              <TooltipContent>This redirect is read-only (defined in config)</TooltipContent>
            </Tooltip>
          </div>
        </TableCell>
      </TableRow>
    );
  };

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-hidden p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Redirects</h1>
          <p className="text-sm text-muted-foreground">
            Manage proxy rules and redirects for your applications
          </p>
        </div>
        <Button size="sm" onClick={handleAddClick}>
          <Icon className="size-4" icon="lucide:plus" />
          <span>New Redirect</span>
        </Button>
      </div>

      <div className="flex-1 overflow-auto rounded-md border">
        {rules$.isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Icon className="size-6 animate-spin" icon="lucide:loader-2" />
          </div>
        ) : redirects.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            No redirects configured yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Name</TableHead>
                <TableHead>Pattern</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staticRedirects.map(renderStaticRow)}
              {dynamicRedirects.map((redirect, index) => (
                <SortableRow
                  key={redirect.id}
                  index={index}
                  redirect={redirect}
                  onDelete={handleDeleteClick}
                  onEdit={handleEditClick}
                  onMove={handleMove}
                  onToggle={(id) => toggle$.mutate(id)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <RedirectDrawer
        open={drawerOpen}
        readonly={editingRedirect?.readonly}
        redirect={editingRedirect}
        onOpenChange={setDrawerOpen}
        onSave={handleSave}
      />

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open: boolean) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Redirect</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the redirect "{deleteTarget?.name}"? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
