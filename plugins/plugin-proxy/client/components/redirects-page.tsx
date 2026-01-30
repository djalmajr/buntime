import { useState } from "react";
import {
  type ProxyRule,
  useCreateProxyRule,
  useDeleteProxyRule,
  useProxyRules,
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

  const renderActionCell = (redirect: ProxyRule) => {
    const isReadonly = redirect.readonly;

    const deleteButton = (
      <Button
        className="size-8"
        disabled={isReadonly}
        size="icon"
        variant="ghost"
        onClick={() => handleDeleteClick(redirect)}
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
          onClick={() => handleEditClick(redirect)}
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
                <TableHead>Name</TableHead>
                <TableHead>Pattern</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {redirects.map((redirect) => (
                <TableRow key={redirect.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{redirect.name || redirect.pattern}</span>
                      {redirect.readonly && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          Fixed
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5">{redirect.pattern}</code>
                  </TableCell>
                  <TableCell>
                    <span className="max-w-[200px] truncate">{redirect.target}</span>
                  </TableCell>
                  <TableCell>{renderActionCell(redirect)}</TableCell>
                </TableRow>
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
