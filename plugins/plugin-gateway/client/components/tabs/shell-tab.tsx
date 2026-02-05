import { useEffect, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { gatewayApi, type ShellExcludeEntry } from "~/lib/api";

interface ShellTabProps {
  enabled: boolean;
  dir: string | null;
  excludes: ShellExcludeEntry[];
  onRefresh?: () => void;
}

export function ShellTab({ enabled, dir, excludes: initialExcludes, onRefresh }: ShellTabProps) {
  const [excludes, setExcludes] = useState<ShellExcludeEntry[]>(initialExcludes);
  const [newExclude, setNewExclude] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isRemoving, setIsRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setExcludes(initialExcludes);
  }, [initialExcludes]);

  const addExclude = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExclude.trim()) return;

    setIsAdding(true);
    setError(null);
    try {
      const result = await gatewayApi.addShellExclude(newExclude.trim());
      if (result.added) {
        setExcludes((prev) => [...prev, { basename: newExclude.trim(), source: "keyval" }]);
        setNewExclude("");
        onRefresh?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add exclude");
    } finally {
      setIsAdding(false);
    }
  };

  const removeExclude = async (basename: string) => {
    setIsRemoving(basename);
    setError(null);
    try {
      await gatewayApi.removeShellExclude(basename);
      setExcludes((prev) => prev.filter((e) => e.basename !== basename));
      onRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove exclude");
    } finally {
      setIsRemoving(null);
    }
  };

  if (!enabled) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Shell is not enabled</p>
          <p className="text-sm text-muted-foreground mt-2">
            Set GATEWAY_SHELL_DIR environment variable or shellDir in config
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Shell Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shell Configuration</CardTitle>
          <CardDescription>Micro-frontend shell application</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant="success">Active</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Directory</span>
              <span className="font-mono text-sm truncate max-w-64" title={dir ?? ""}>
                {dir}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Excludes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shell Excludes</CardTitle>
          <CardDescription>Applications that bypass the shell (served directly)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="p-2 bg-destructive/10 text-destructive text-sm rounded">{error}</div>
          )}

          {/* Add Form */}
          <form onSubmit={addExclude} className="flex gap-2">
            <Input
              placeholder="app-basename"
              value={newExclude}
              onChange={(e) => setNewExclude(e.target.value)}
              disabled={isAdding}
            />
            <Button type="submit" disabled={isAdding || !newExclude.trim()}>
              {isAdding ? "Adding..." : "Add"}
            </Button>
          </form>

          {/* Excludes List */}
          {excludes.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">
              No excludes configured. All apps are served through the shell.
            </p>
          ) : (
            <ScrollArea className="h-[250px]">
              <div className="space-y-2">
                {excludes.map((exclude) => (
                  <div
                    key={exclude.basename}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm">{exclude.basename}</span>
                      <Badge variant={exclude.source === "env" ? "secondary" : "outline"} size="sm">
                        {exclude.source === "env" ? "env" : "dynamic"}
                      </Badge>
                    </div>
                    {exclude.source === "keyval" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeExclude(exclude.basename)}
                        disabled={isRemoving !== null}
                      >
                        {isRemoving === exclude.basename ? "..." : "Remove"}
                      </Button>
                    )}
                    {exclude.source === "env" && (
                      <span className="text-xs text-muted-foreground">Set via environment</span>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          <p className="text-xs text-muted-foreground">
            Tip: You can also set shell excludes via the GATEWAY_SHELL_EXCLUDES environment variable
            (comma-separated) or the gateway_shell_excludes cookie.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
