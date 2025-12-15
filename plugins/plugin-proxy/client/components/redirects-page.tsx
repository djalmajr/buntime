import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { DataTable } from "~/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import {
  type ProxyRule,
  useCreateProxyRule,
  useDeleteProxyRule,
  useProxyRules,
  useUpdateProxyRule,
} from "~/hooks/use-proxy-rules";
import { Icon } from "./icon";
import { type RedirectData, RedirectDrawer } from "./redirect-drawer";

export function RedirectsPage() {
  const [deleteTarget, setDeleteTarget] = useState<ProxyRule | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRedirect, setEditingRedirect] = useState<ProxyRule | null>(null);

  const rules$ = useProxyRules();
  const create$ = useCreateProxyRule();
  const update$ = useUpdateProxyRule();
  const delete$ = useDeleteProxyRule();

  const redirects = rules$.data ?? [];

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

  const columns: ColumnDef<ProxyRule>[] = [
    {
      accessorKey: "name",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.original.name || row.original.pattern}</span>
          {row.original.readonly && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              Fixed
            </span>
          )}
        </div>
      ),
      header: "Name",
    },
    {
      accessorKey: "pattern",
      cell: ({ row }) => (
        <code className="rounded bg-muted px-1.5 py-0.5">{row.original.pattern}</code>
      ),
      header: "Pattern",
    },
    {
      accessorKey: "target",
      cell: ({ row }) => <span className="max-w-[200px] truncate">{row.original.target}</span>,
      header: "Target",
    },
    {
      cell: ({ row }) => {
        const isReadonly = row.original.readonly;

        const deleteButton = (
          <Button
            className="size-8"
            disabled={isReadonly}
            size="icon"
            variant="ghost"
            onClick={() => handleDeleteClick(row.original)}
          >
            <Icon className="size-4.5" icon="lucide:trash-2" />
          </Button>
        );

        return (
          <div className="flex items-center justify-end gap-1">
            <Button
              className="size-8"
              size="icon"
              variant="ghost"
              onClick={() => handleEditClick(row.original)}
            >
              <Icon className="size-4.5" icon={isReadonly ? "lucide:eye" : "lucide:pencil"} />
            </Button>
            {isReadonly ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-not-allowed">{deleteButton}</span>
                </TooltipTrigger>
                <TooltipContent>This redirect is read-only (defined in config)</TooltipContent>
              </Tooltip>
            ) : (
              deleteButton
            )}
          </div>
        );
      },
      header: () => <div className="text-right">Actions</div>,
      id: "actions",
    },
  ];

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

      <DataTable
        columns={columns}
        data={redirects}
        emptyText="No redirects configured yet."
        isLoading={rules$.isLoading}
      />

      <RedirectDrawer
        open={drawerOpen}
        readonly={editingRedirect?.readonly}
        redirect={editingRedirect}
        onOpenChange={setDrawerOpen}
        onSave={handleSave}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
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
