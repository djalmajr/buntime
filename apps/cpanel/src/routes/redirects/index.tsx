import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CrudLayout } from "~/components/crud-layout";
import { DataTable } from "~/components/data-table";
import { Icon } from "~/components/icon";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { type RedirectData, RedirectDrawer } from "./-components/redirect-drawer";
import {
  type ProxyRule,
  useCreateProxyRule,
  useDeleteProxyRule,
  useProxyRules,
  useUpdateProxyRule,
} from "./-hooks/use-proxy-rules";

function RedirectsListPage() {
  const { t } = useTranslation("redirects");
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
              {t("list.fixed")}
            </span>
          )}
        </div>
      ),
      header: t("list.name"),
    },
    {
      accessorKey: "pattern",
      cell: ({ row }) => (
        <code className="rounded bg-muted px-1.5 py-0.5">{row.original.pattern}</code>
      ),
      header: t("list.pattern"),
    },
    {
      accessorKey: "target",
      cell: ({ row }) => <span className="max-w-[200px] truncate">{row.original.target}</span>,
      header: t("list.target"),
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
                <TooltipContent>{t("list.readonlyHint")}</TooltipContent>
              </Tooltip>
            ) : (
              deleteButton
            )}
          </div>
        );
      },
      header: () => <div className="text-right">{t("list.actions")}</div>,
      id: "actions",
    },
  ];

  return (
    <>
      <CrudLayout addButtonText={t("nav.new")} onAddItem={handleAddClick}>
        <DataTable
          columns={columns}
          data={redirects}
          isLoading={rules$.isLoading}
          labels={{
            emptyText: t("list.empty"),
            searchPlaceholder: t("list.searchPlaceholder"),
          }}
        />
      </CrudLayout>

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
            <DialogTitle>{t("confirmDelete.title")}</DialogTitle>
            <DialogDescription>
              {t("confirmDelete.description", { name: deleteTarget?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("confirmDelete.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm}>
              {t("confirmDelete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export const Route = createFileRoute("/redirects/")({
  component: RedirectsListPage,
  loader: () => ({ breadcrumb: "redirects:title" }),
});
