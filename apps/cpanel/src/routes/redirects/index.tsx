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
import { type RedirectData, RedirectDrawer } from "./-components/redirect-drawer";

interface Redirect extends RedirectData {
  id: string;
}

// Mock data - will be replaced with actual API calls
const mockRedirects: Redirect[] = [
  {
    changeOrigin: true,
    id: "1",
    name: "api-proxy",
    pattern: "^/api/(.*)$",
    rewrite: "/v1/$1",
    secure: true,
    target: "http://backend:3000",
  },
  {
    changeOrigin: true,
    headers: { "X-Forwarded-For": "client" },
    id: "2",
    name: "auth-proxy",
    pattern: "^/_api/login$",
    rewrite: "/auth/login",
    secure: false,
    target: "http://auth-service:8080",
  },
];

function RedirectsListPage() {
  const { t } = useTranslation("redirects");
  const [redirects, setRedirects] = useState<Redirect[]>(mockRedirects);
  const [deleteTarget, setDeleteTarget] = useState<Redirect | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRedirect, setEditingRedirect] = useState<Redirect | null>(null);

  const handleAddClick = () => {
    setEditingRedirect(null);
    setDrawerOpen(true);
  };

  const handleEditClick = (redirect: Redirect) => {
    setEditingRedirect(redirect);
    setDrawerOpen(true);
  };

  const handleDeleteClick = (redirect: Redirect) => {
    setDeleteTarget(redirect);
  };

  const handleDeleteConfirm = () => {
    if (deleteTarget) {
      setRedirects((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      setDeleteTarget(null);
    }
  };

  const handleSave = (data: RedirectData) => {
    if (editingRedirect) {
      // Update existing redirect
      setRedirects((prev) =>
        prev.map((r) => (r.id === editingRedirect.id ? { ...data, id: editingRedirect.id } : r)),
      );
    } else {
      // Create new redirect
      const newRedirect: Redirect = {
        ...data,
        id: String(Date.now()),
      };
      setRedirects((prev) => [...prev, newRedirect]);
    }
  };

  const columns: ColumnDef<Redirect>[] = [
    {
      accessorKey: "name",
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      header: t("list.name"),
    },
    {
      accessorKey: "pattern",
      cell: ({ row }) => (
        <code className="rounded bg-muted px-1.5 py-0.5 text-sm">{row.original.pattern}</code>
      ),
      header: t("list.pattern"),
    },
    {
      accessorKey: "target",
      cell: ({ row }) => (
        <span className="max-w-[200px] truncate text-sm">{row.original.target}</span>
      ),
      header: t("list.target"),
    },
    {
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            className="size-7"
            size="icon"
            variant="ghost"
            onClick={() => handleEditClick(row.original)}
          >
            <Icon className="size-3.5" icon="lucide:pencil" />
          </Button>
          <Button
            className="size-7"
            size="icon"
            variant="ghost"
            onClick={() => handleDeleteClick(row.original)}
          >
            <Icon className="size-3.5" icon="lucide:trash-2" />
          </Button>
        </div>
      ),
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
          isLoading={false}
          labels={{
            emptyText: t("list.empty"),
            searchPlaceholder: t("list.searchPlaceholder"),
          }}
        />
      </CrudLayout>

      <RedirectDrawer
        onOpenChange={setDrawerOpen}
        onSave={handleSave}
        open={drawerOpen}
        redirect={editingRedirect}
      />

      <Dialog onOpenChange={(open) => !open && setDeleteTarget(null)} open={!!deleteTarget}>
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
