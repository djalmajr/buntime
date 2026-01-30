import type { KvEntry, KvKey } from "@buntime/keyval";
import {
  Badge,
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
} from "@zomme/shadcn-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { kv } from "~/helpers/kv";

interface TreeNode {
  children: Map<string, TreeNode>;
  count: number;
  entries: KvEntry[];
  name: string;
  path: string[];
}

function buildTree(entries: KvEntry[]): TreeNode {
  const root: TreeNode = {
    children: new Map(),
    count: entries.length,
    entries: [],
    name: "",
    path: [],
  };

  for (const entry of entries) {
    let current = root;
    const path: string[] = [];

    for (let i = 0; i < entry.key.length; i++) {
      const part = String(entry.key[i]);
      path.push(part);

      if (!current.children.has(part)) {
        current.children.set(part, {
          children: new Map(),
          count: 0,
          entries: [],
          name: part,
          path: [...path],
        });
      }

      current = current.children.get(part)!;
      current.count++;

      // If this is the last key part, store the entry
      if (i === entry.key.length - 1) {
        current.entries.push(entry);
      }
    }
  }

  return root;
}

function formatKey(key: KvKey): string {
  return key.map((k) => String(k)).join("/");
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function parseKeyPath(keyPath: string): KvKey {
  if (!keyPath.trim()) return [];
  return keyPath.split("/").map((p) => {
    const trimmed = p.trim();
    const num = Number(trimmed);
    return Number.isNaN(num) ? trimmed : num;
  });
}

interface TreeViewProps {
  expandedPaths: Set<string>;
  node: TreeNode;
  selectedPath: string | null;
  onSelect: (path: string[], entries: KvEntry[]) => void;
  onToggle: (pathKey: string) => void;
}

function TreeView({ expandedPaths, node, selectedPath, onSelect, onToggle }: TreeViewProps) {
  const pathKey = node.path.join("/");
  const isExpanded = expandedPaths.has(pathKey);
  const hasChildren = node.children.size > 0;
  const isSelected = selectedPath === pathKey;

  return (
    <div className="ml-2">
      {node.name && (
        <div
          className={cn(
            "flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-accent",
            isSelected && "bg-accent",
          )}
          onClick={() => {
            if (hasChildren) {
              onToggle(pathKey);
            }
            onSelect(node.path, node.entries);
          }}
        >
          {hasChildren ? (
            <Icon
              className="size-4 shrink-0 text-muted-foreground"
              icon={isExpanded ? "lucide:chevron-down" : "lucide:chevron-right"}
            />
          ) : (
            <Icon className="size-4 shrink-0 text-muted-foreground" icon="lucide:file" />
          )}
          <span className="truncate">{node.name}</span>
          <span className="ml-auto text-xs text-muted-foreground">{node.count}</span>
        </div>
      )}
      {(isExpanded || !node.name) && hasChildren && (
        <div className={node.name ? "ml-2 border-l border-border pl-1" : ""}>
          {Array.from(node.children.values())
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((child) => (
              <TreeView
                key={child.path.join("/")}
                expandedPaths={expandedPaths}
                node={child}
                selectedPath={selectedPath}
                onSelect={onSelect}
                onToggle={onToggle}
              />
            ))}
        </div>
      )}
    </div>
  );
}

export function KeyvalExplorer() {
  const { t } = useTranslation();

  // Data state
  const [entries, setEntries] = useState<KvEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // Tree state
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedEntries, setSelectedEntries] = useState<KvEntry[]>([]);

  // Dialogs
  const [editDialog, setEditDialog] = useState<{
    entry: KvEntry;
    open: boolean;
    value: string;
  } | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{
    entry: KvEntry;
    open: boolean;
  } | null>(null);
  const [addDialog, setAddDialog] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("{}");

  // Load all entries
  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const results: KvEntry[] = [];
      for await (const entry of kv.list([], { limit: 10000 })) {
        results.push(entry);
      }
      setEntries(results);
    } catch (error) {
      console.error("Failed to load entries:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // Build tree from entries
  const tree = useMemo(() => buildTree(entries), [entries]);

  // Filter entries based on search
  const filteredEntries = useMemo(() => {
    if (!search) return entries;
    const lowerSearch = search.toLowerCase();
    return entries.filter((e) => formatKey(e.key).toLowerCase().includes(lowerSearch));
  }, [entries, search]);

  const filteredTree = useMemo(() => buildTree(filteredEntries), [filteredEntries]);

  const handleToggle = useCallback((pathKey: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) {
        next.delete(pathKey);
      } else {
        next.add(pathKey);
      }
      return next;
    });
  }, []);

  const handleSelect = useCallback((path: string[], nodeEntries: KvEntry[]) => {
    setSelectedPath(path.join("/"));
    setSelectedEntries(nodeEntries);
  }, []);

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

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteDialog) return;

    await kv.delete(deleteDialog.entry.key, { exact: true });
    setDeleteDialog(null);
    setSelectedEntries((prev) =>
      prev.filter((e) => formatKey(e.key) !== formatKey(deleteDialog.entry.key)),
    );
    await loadEntries();
  }, [deleteDialog, loadEntries]);

  const handleAddRecord = useCallback(async () => {
    try {
      const key = parseKeyPath(newKey);
      const value = JSON.parse(newValue);
      await kv.set(key, value);
      setAddDialog(false);
      setNewKey("");
      setNewValue("{}");
      await loadEntries();
    } catch {
      // JSON parse error
    }
  }, [newKey, newValue, loadEntries]);

  return (
    <div className="flex h-full">
      {/* Sidebar - Tree */}
      <div className="flex w-72 flex-col border-r border-border bg-muted/30">
        {/* Header */}
        <div className="border-b border-border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Icon className="size-4" icon="lucide:folder-tree" />
            KeyVal Explorer
          </div>
        </div>

        {/* Search & Actions */}
        <div className="flex items-center gap-1 border-b border-border p-2">
          <Input
            className="h-8 text-sm"
            placeholder="Search keys..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button
            className="size-8 shrink-0"
            size="icon"
            title={t("entries.refresh")}
            variant="ghost"
            onClick={loadEntries}
          >
            <Icon
              className={cn("size-4", loading && "animate-spin")}
              icon={loading ? "lucide:loader-2" : "lucide:refresh-cw"}
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

        {/* Tree */}
        <ScrollArea className="flex-1">
          {loading ? (
            <div className="space-y-1 p-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton className="h-6 w-full" key={i} />
              ))}
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {search ? "No matching keys" : "No entries"}
            </div>
          ) : (
            <div className="py-1">
              <TreeView
                expandedPaths={expandedPaths}
                node={filteredTree}
                selectedPath={selectedPath}
                onSelect={handleSelect}
                onToggle={handleToggle}
              />
            </div>
          )}
        </ScrollArea>

        {/* Stats */}
        <div className="border-t border-border p-2 text-xs text-muted-foreground">
          {filteredEntries.length} entries
          {search && ` (${entries.length} total)`}
        </div>
      </div>

      {/* Main Content - Entry Details */}
      <div className="flex flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          {selectedPath ? (
            <>
              <Icon className="size-4 text-muted-foreground" icon="lucide:key" />
              <span className="font-mono text-sm">{selectedPath || "(root)"}</span>
              <Badge variant="outline">{selectedEntries.length} values</Badge>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">Select a key to view details</span>
          )}

          <div className="flex-1" />

          <Button className="h-8" size="sm" variant="default" onClick={() => setAddDialog(true)}>
            <Icon className="size-4" icon="lucide:plus" />
            Add
          </Button>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1">
          {!selectedPath ? (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
              <Icon className="mb-4 size-12" icon="lucide:key" />
              <p>Select a key from the tree to view its value</p>
            </div>
          ) : selectedEntries.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
              <Icon className="mb-4 size-12" icon="lucide:folder" />
              <p>This is a prefix node with no direct value</p>
              <p className="text-sm">Expand it in the tree to see child entries</p>
            </div>
          ) : (
            <div className="space-y-4 p-4">
              {selectedEntries.map((entry) => (
                <div key={formatKey(entry.key)} className="rounded-lg border bg-card">
                  {/* Entry Header */}
                  <div className="flex items-center justify-between border-b px-4 py-2">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-medium">{formatKey(entry.key)}</code>
                      {entry.versionstamp && (
                        <Badge size="sm" variant="outline">
                          {entry.versionstamp.slice(0, 12)}...
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() =>
                          setEditDialog({
                            entry,
                            open: true,
                            value: JSON.stringify(entry.value, null, 2),
                          })
                        }
                      >
                        <Icon className="size-4" icon="lucide:edit" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => setDeleteDialog({ entry, open: true })}
                      >
                        <Icon className="size-4 text-destructive" icon="lucide:trash-2" />
                      </Button>
                    </div>
                  </div>
                  {/* Entry Value */}
                  <pre className="overflow-auto p-4 font-mono text-sm">
                    {formatValue(entry.value)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
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
              {t("entries.confirmDelete")}
              <code className="mt-2 block rounded bg-muted p-2 font-mono text-sm">
                {deleteDialog ? formatKey(deleteDialog.entry.key) : ""}
              </code>
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
