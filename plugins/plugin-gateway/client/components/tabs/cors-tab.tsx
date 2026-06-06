import { useMemo, useState } from "react";
import { DataTable } from "~/components/data-table/data-table";
import { DataTableColumnHeader } from "~/components/data-table/data-table-column-header";
import { type ColumnDef, useDataTable } from "~/components/data-table/use-data-table";
import { Button } from "~/components/ui/button";
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
import { type CorsRule, type CorsRuleInput, gatewayApi } from "~/lib/api";
import { cn } from "~/utils/cn";

type CorsData = NonNullable<GatewaySSEData["cors"]>;

interface CorsTabProps {
  cors: CorsData | null;
}

const ALL_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const DEFAULT_METHODS = ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"];

function splitList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** A toggleable pill used for methods. */
function Toggle({
  active,
  children,
  disabled,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-accent",
        disabled && "cursor-not-allowed opacity-50",
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

interface RuleFormState {
  name: string;
  originsText: string;
  methods: string[];
  allowedHeadersText: string;
  exposedHeadersText: string;
  credentials: boolean;
  maxAgeText: string;
}

function emptyForm(): RuleFormState {
  return {
    name: "",
    originsText: "",
    methods: DEFAULT_METHODS,
    allowedHeadersText: "",
    exposedHeadersText: "",
    credentials: false,
    maxAgeText: "86400",
  };
}

function formFromRule(rule: CorsRule): RuleFormState {
  return {
    name: rule.name,
    originsText: rule.origins.join(", "),
    methods: rule.methods ?? DEFAULT_METHODS,
    allowedHeadersText: rule.allowedHeaders?.join(", ") ?? "",
    exposedHeadersText: rule.exposedHeaders?.join(", ") ?? "",
    credentials: rule.credentials ?? false,
    maxAgeText: String(rule.maxAge ?? 86400),
  };
}

export function CorsTab({ cors }: CorsTabProps) {
  const rules = cors?.rules ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmRule, setConfirmRule] = useState<CorsRule | null>(null);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setError(null);
    setDialogOpen(true);
  };

  const openEdit = (rule: CorsRule) => {
    setEditingId(rule.id);
    setForm(formFromRule(rule));
    setError(null);
    setDialogOpen(true);
  };

  const update = (patch: Partial<RuleFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setError(null);
  };

  const isWildcard = splitList(form.originsText).includes("*");

  const toggleMethod = (method: string) => {
    update({
      methods: form.methods.includes(method)
        ? form.methods.filter((m) => m !== method)
        : [...form.methods, method],
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: CorsRuleInput = {
        name: form.name.trim(),
        origins: splitList(form.originsText),
        methods: form.methods,
        allowedHeaders: splitList(form.allowedHeadersText),
        exposedHeaders: splitList(form.exposedHeadersText),
        credentials: form.credentials,
        maxAge: form.maxAgeText ? Number(form.maxAgeText) : undefined,
      };
      if (editingId) {
        await gatewayApi.updateCorsRule(editingId, payload);
      } else {
        await gatewayApi.createCorsRule(payload);
      }
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save CORS rule");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await gatewayApi.deleteCorsRule(id);
      setConfirmRule(null);
    } catch {
      // Surface nothing destructive; the SSE refresh keeps the list in sync.
    } finally {
      setDeletingId(null);
    }
  };

  const columns = useMemo<ColumnDef<CorsRule, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} label="Name" />,
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        id: "origins",
        accessorFn: (row) => row.origins.join(" "),
        header: ({ column }) => <DataTableColumnHeader column={column} label="Origins" />,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.origins.join(", ")}</span>
        ),
      },
      {
        id: "methods",
        accessorFn: (row) => (row.methods ?? []).join(" "),
        header: ({ column }) => <DataTableColumnHeader column={column} label="Methods" />,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {(row.original.methods ?? []).join(", ") || "—"}
          </span>
        ),
      },
      {
        accessorKey: "credentials",
        header: ({ column }) => <DataTableColumnHeader column={column} label="Credentials" />,
        cell: ({ row }) => (
          <span className="text-xs uppercase text-muted-foreground">
            {row.original.credentials ? "Yes" : "No"}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        enableGlobalFilter: false,
        size: 80,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button onClick={() => openEdit(row.original)} size="icon-sm" variant="ghost">
              <Icon className="size-4" icon="lucide:pencil" />
            </Button>
            <Button onClick={() => setConfirmRule(row.original)} size="icon-sm" variant="ghost">
              <Icon className="size-4 text-destructive" icon="lucide:trash-2" />
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  const { table, globalFilter, setGlobalFilter } = useDataTable({ columns, data: rules });

  return (
    <div className="space-y-4">
      {/* Intro — kept at the top (not a card) so it stays visible as the list grows */}
      <p className="text-sm text-muted-foreground">
        Each rule grants a cross-origin policy to the origins it matches. A request's{" "}
        <code className="font-mono">Origin</code> is matched against the rules; if none match, no
        CORS headers are sent (the browser blocks the cross-origin call). Rules apply immediately —
        no restart required.
      </p>

      <DataTable
        labels={{ noResults: "No CORS rules yet — add one to allow cross-origin requests." }}
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
              placeholder="Search rules by name, origin or method…"
              value={globalFilter}
            />
          </div>
          <Button onClick={openCreate} size="sm" type="button">
            <Icon className="size-4" icon="lucide:plus" />
            New rule
          </Button>
        </div>
      </DataTable>

      {/* Create / Edit modal */}
      <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit CORS rule" : "New CORS rule"}</DialogTitle>
            <DialogDescription>
              Define which origins are allowed and what they can do.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Name</span>
              <Input
                placeholder="e.g. Public API, Internal apps"
                value={form.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <span className="text-sm font-medium">Origins</span>
              <Input
                placeholder="*.example.com, https://app.example.com"
                value={form.originsText}
                onChange={(e) => update({ originsText: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Exact origin, subdomain wildcard (<code className="font-mono">*.example.com</code>),
                or <code className="font-mono">*</code> for all. Comma-separated.
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="text-sm font-medium">Methods</span>
              <div className="flex flex-wrap gap-2">
                {ALL_METHODS.map((method) => (
                  <Toggle
                    key={method}
                    active={form.methods.includes(method)}
                    onClick={() => toggleMethod(method)}
                  >
                    {method}
                  </Toggle>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Credentials</p>
                <p className="text-xs text-muted-foreground">
                  Allow cookies/auth{isWildcard && " (not allowed with *)"}
                </p>
              </div>
              <Toggle
                active={form.credentials}
                disabled={isWildcard}
                onClick={() => update({ credentials: !form.credentials })}
              >
                {form.credentials ? "Enabled" : "Disabled"}
              </Toggle>
            </div>

            <div className="space-y-1.5">
              <span className="text-sm font-medium">Allowed Headers</span>
              <Input
                placeholder="Leave empty to reflect requested headers"
                value={form.allowedHeadersText}
                onChange={(e) => update({ allowedHeadersText: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <span className="text-sm font-medium">Exposed Headers</span>
              <Input
                placeholder="Headers exposed to the browser"
                value={form.exposedHeadersText}
                onChange={(e) => update({ exposedHeadersText: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <span className="text-sm font-medium">Preflight Max-Age (seconds)</span>
              <Input
                className="w-40"
                inputMode="numeric"
                placeholder="86400"
                value={form.maxAgeText}
                onChange={(e) => update({ maxAgeText: e.target.value.replace(/[^0-9]/g, "") })}
              />
            </div>

            {error && (
              <div className="rounded bg-destructive/10 p-2 text-sm text-destructive">{error}</div>
            )}
          </div>

          <DialogFooter>
            <Button onClick={() => setDialogOpen(false)} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={saving} onClick={handleSave} type="button">
              {saving ? "Saving..." : editingId ? "Save changes" : "Create rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog onOpenChange={(open) => !open && setConfirmRule(null)} open={confirmRule !== null}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete CORS rule?</DialogTitle>
            <DialogDescription>
              This removes the rule <span className="font-medium">{confirmRule?.name}</span> (
              {confirmRule?.origins.join(", ")}). Cross-origin requests it allowed will be blocked.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmRule(null)} type="button" variant="outline">
              Cancel
            </Button>
            <Button
              disabled={deletingId !== null}
              onClick={() => confirmRule && handleDelete(confirmRule.id)}
              type="button"
              variant="destructive"
            >
              {deletingId ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
