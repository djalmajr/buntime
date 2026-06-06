import { useEffect, useMemo, useState } from "react";
import { DataTable } from "~/components/data-table/data-table";
import { DataTableColumnHeader } from "~/components/data-table/data-table-column-header";
import { type ColumnDef, useDataTable } from "~/components/data-table/use-data-table";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Icon } from "~/components/ui/icon";
import { Input } from "~/components/ui/input";
import type { GatewaySSEData } from "~/helpers/sse";
import { gatewayApi, type ShellExcludeEntry } from "~/lib/api";

type ShellData = NonNullable<GatewaySSEData["shell"]>;

interface ShellTabProps {
  shell: ShellData | null;
}

export function ShellTab({ shell }: ShellTabProps) {
  return (
    <div className="space-y-4">
      <ShellConfiguration shell={shell} />
      {shell && <ShellExcludes excludes={shell.excludes} />}
    </div>
  );
}

function ShellConfiguration({ shell }: { shell: ShellData | null }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dir, setDir] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDialog = () => {
    setDir(shell?.dir ?? "");
    setError(null);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await gatewayApi.setShellDir(dir.trim());
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set shell directory");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await gatewayApi.resetShellDir();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card>
        <CardContent className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Shell directory</span>
              {shell ? (
                <Badge size="sm" variant="success">
                  Active
                </Badge>
              ) : (
                <Badge size="sm" variant="secondary">
                  Not configured
                </Badge>
              )}
              {shell && (
                <Badge size="sm" variant={shell.source === "override" ? "default" : "secondary"}>
                  {shell.source === "override" ? "Custom" : "Default"}
                </Badge>
              )}
            </div>
            <p
              className="truncate font-mono text-xs text-muted-foreground"
              title={shell?.dir ?? ""}
            >
              {shell?.dir ?? "No micro-frontend shell configured"}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {shell?.source === "override" && (
              <Button disabled={saving} onClick={handleReset} size="sm" variant="outline">
                Reset to default
              </Button>
            )}
            <Button onClick={openDialog} size="sm" variant={shell ? "outline" : "default"}>
              {shell ? "Change" : "Configure"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Shell directory</DialogTitle>
            <DialogDescription>
              Absolute path to the micro-frontend shell application (must contain a manifest and
              build). Seeded by the ConfigMap/env (
              <code className="font-mono">GATEWAY_SHELL_DIR</code>
              ); this saves a runtime override applied immediately — no restart.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              className="font-mono"
              onChange={(e) => setDir(e.target.value)}
              placeholder="/data/apps/example-spa/1.0.0"
              value={dir}
            />
            {shell?.seedDir && (
              <p className="text-xs text-muted-foreground">
                ConfigMap/env seed: <code className="font-mono">{shell.seedDir}</code>
              </p>
            )}
            {error && (
              <div className="rounded bg-destructive/10 p-2 text-sm text-destructive">{error}</div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setDialogOpen(false)} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={saving || !dir.trim()} onClick={handleSave} type="button">
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ShellExcludes({ excludes: initialExcludes }: { excludes: ShellExcludeEntry[] }) {
  const [excludes, setExcludes] = useState<ShellExcludeEntry[]>(initialExcludes);
  const [addOpen, setAddOpen] = useState(false);
  const [newExclude, setNewExclude] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ShellExcludeEntry | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    setExcludes(initialExcludes);
  }, [initialExcludes]);

  const addExclude = async () => {
    const basename = newExclude.trim();
    if (!basename) return;
    setSaving(true);
    setError(null);
    try {
      const result = await gatewayApi.addShellExclude(basename);
      if (result.added) {
        setExcludes((prev) => [...prev, { basename, source: "turso" }]);
      }
      setNewExclude("");
      setAddOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add exclude");
    } finally {
      setSaving(false);
    }
  };

  const removeExclude = async (basename: string) => {
    setRemoving(true);
    try {
      await gatewayApi.removeShellExclude(basename);
      setExcludes((prev) => prev.filter((e) => e.basename !== basename));
      setConfirm(null);
    } finally {
      setRemoving(false);
    }
  };

  const columns = useMemo<ColumnDef<ShellExcludeEntry, unknown>[]>(
    () => [
      {
        accessorKey: "basename",
        header: ({ column }) => <DataTableColumnHeader column={column} label="Basename" />,
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.basename}</span>,
      },
      {
        accessorKey: "source",
        header: ({ column }) => <DataTableColumnHeader column={column} label="Source" />,
        size: 140,
        cell: ({ row }) => (
          <Badge size="sm" variant={row.original.source === "env" ? "secondary" : "outline"}>
            {row.original.source === "env" ? "env" : "dynamic"}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableGlobalFilter: false,
        size: 90,
        cell: ({ row }) =>
          row.original.source === "env" ? (
            <span className="block text-right text-xs text-muted-foreground">via env</span>
          ) : (
            <div className="flex justify-end">
              <Button onClick={() => setConfirm(row.original)} size="icon-sm" variant="ghost">
                <Icon className="size-4 text-destructive" icon="lucide:trash-2" />
              </Button>
            </div>
          ),
      },
    ],
    [],
  );

  const { table, globalFilter, setGlobalFilter } = useDataTable({ columns, data: excludes });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Applications that bypass the shell and are served directly.{" "}
        <code className="font-mono">env</code> entries come from the ConfigMap/env seed
        (non-removable); <code className="font-mono">dynamic</code> entries are runtime overrides
        stored in the database.
      </p>
      {error && (
        <div className="rounded bg-destructive/10 p-2 text-sm text-destructive">{error}</div>
      )}
      <DataTable
        labels={{ noResults: "No excludes — all apps are served through the shell." }}
        table={table}
      >
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Icon
              className="-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-muted-foreground"
              icon="lucide:search"
            />
            <Input
              className="h-9 pl-8"
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Search excludes…"
              value={globalFilter}
            />
          </div>
          <Button onClick={() => setAddOpen(true)} size="sm" type="button">
            <Icon className="size-4" icon="lucide:plus" />
            Add exclude
          </Button>
        </div>
      </DataTable>

      {/* Add exclude modal */}
      <Dialog onOpenChange={setAddOpen} open={addOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add shell exclude</DialogTitle>
            <DialogDescription>
              App basename to serve directly, bypassing the shell.
            </DialogDescription>
          </DialogHeader>
          <Input
            className="font-mono"
            onChange={(e) => setNewExclude(e.target.value)}
            placeholder="admin"
            value={newExclude}
          />
          <DialogFooter>
            <Button onClick={() => setAddOpen(false)} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={saving || !newExclude.trim()} onClick={addExclude} type="button">
              {saving ? "Adding..." : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirmation */}
      <Dialog onOpenChange={(open) => !open && setConfirm(null)} open={confirm !== null}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Remove exclude?</DialogTitle>
            <DialogDescription>
              <span className="font-medium">{confirm?.basename}</span> will be served through the
              shell again. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirm(null)} type="button" variant="outline">
              Cancel
            </Button>
            <Button
              disabled={removing}
              onClick={() => confirm && removeExclude(confirm.basename)}
              type="button"
              variant="destructive"
            >
              {removing ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
