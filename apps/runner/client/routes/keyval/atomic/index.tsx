import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { kv } from "~/helpers/kv";
import { PageHeader } from "~/routes/-components/page-header";

type OperationType = "set" | "delete" | "sum" | "max" | "min" | "append" | "prepend";

interface AtomicOperation {
  id: string;
  key: string;
  type: OperationType;
  value?: string;
}

interface VersionstampCheck {
  id: string;
  key: string;
  versionstamp: string;
}

interface AtomicResult {
  ok: boolean;
  versionstamp?: string | null;
}

function AtomicPage() {
  const { t } = useTranslation("keyval.atomic");
  const [operations, setOperations] = useState<AtomicOperation[]>([]);
  const [checks, setChecks] = useState<VersionstampCheck[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AtomicResult | null>(null);

  // New operation form state
  const [newOpType, setNewOpType] = useState<OperationType>("set");
  const [newOpKey, setNewOpKey] = useState("");
  const [newOpValue, setNewOpValue] = useState("");

  // New check form state
  const [newCheckKey, setNewCheckKey] = useState("");
  const [newCheckVersionstamp, setNewCheckVersionstamp] = useState("");

  const handleAddOperation = useCallback(() => {
    if (!newOpKey) return;

    const operation: AtomicOperation = {
      id: crypto.randomUUID(),
      key: newOpKey,
      type: newOpType,
      value: newOpValue || undefined,
    };

    setOperations((prev) => [...prev, operation]);
    setNewOpKey("");
    setNewOpValue("");
  }, [newOpType, newOpKey, newOpValue]);

  const handleRemoveOperation = useCallback((id: string) => {
    setOperations((prev) => prev.filter((op) => op.id !== id));
  }, []);

  const handleAddCheck = useCallback(() => {
    if (!newCheckKey) return;

    const check: VersionstampCheck = {
      id: crypto.randomUUID(),
      key: newCheckKey,
      versionstamp: newCheckVersionstamp,
    };

    setChecks((prev) => [...prev, check]);
    setNewCheckKey("");
    setNewCheckVersionstamp("");
  }, [newCheckKey, newCheckVersionstamp]);

  const handleRemoveCheck = useCallback((id: string) => {
    setChecks((prev) => prev.filter((check) => check.id !== id));
  }, []);

  const handleCommit = useCallback(async () => {
    setLoading(true);
    try {
      let atomic = kv.atomic();

      // Add checks
      for (const check of checks) {
        const keyParts = check.key.split(",").map((p) => p.trim());
        const versionstamp = check.versionstamp === "" ? null : check.versionstamp;
        atomic = atomic.check({ key: keyParts, versionstamp });
      }

      // Add operations
      for (const op of operations) {
        const keyParts = op.key.split(",").map((p) => p.trim());

        switch (op.type) {
          case "set": {
            const value = op.value ? JSON.parse(op.value) : null;
            atomic = atomic.set(keyParts, value);
            break;
          }
          case "delete": {
            atomic = atomic.delete(keyParts);
            break;
          }
          case "sum": {
            const amount = op.value ? BigInt(op.value) : 0n;
            atomic = atomic.sum(keyParts, amount);
            break;
          }
          case "max": {
            const value = op.value ? BigInt(op.value) : 0n;
            atomic = atomic.max(keyParts, value);
            break;
          }
          case "min": {
            const value = op.value ? BigInt(op.value) : 0n;
            atomic = atomic.min(keyParts, value);
            break;
          }
          case "append": {
            // Parse JSON array or wrap single value in array
            const values = op.value ? JSON.parse(op.value) : [];
            atomic = atomic.append(keyParts, Array.isArray(values) ? values : [values]);
            break;
          }
          case "prepend": {
            // Parse JSON array or wrap single value in array
            const values = op.value ? JSON.parse(op.value) : [];
            atomic = atomic.prepend(keyParts, Array.isArray(values) ? values : [values]);
            break;
          }
        }
      }

      const commitResult = await atomic.commit();
      setResult(commitResult);
    } catch (error) {
      console.error("Commit error:", error);
      setResult({ ok: false });
    } finally {
      setLoading(false);
    }
  }, [operations, checks]);

  const handleClear = useCallback(() => {
    setOperations([]);
    setChecks([]);
    setResult(null);
  }, []);

  const needsValue = newOpType !== "delete";

  return (
    <ScrollArea className="h-full">
      <div className="m-4 space-y-4">
        <PageHeader description={t("description")} title={t("title")} />

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Operations Builder */}
          <Card>
            <CardHeader>
              <CardTitle>{t("operations.title")}</CardTitle>
              <CardDescription>{t("operations.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>{t("operations.typeLabel")}</Label>
                  <Select
                    value={newOpType}
                    onValueChange={(value) => setNewOpType(value as OperationType)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="set">{t("operations.types.set")}</SelectItem>
                      <SelectItem value="delete">{t("operations.types.delete")}</SelectItem>
                      <SelectItem value="sum">{t("operations.types.sum")}</SelectItem>
                      <SelectItem value="max">{t("operations.types.max")}</SelectItem>
                      <SelectItem value="min">{t("operations.types.min")}</SelectItem>
                      <SelectItem value="append">{t("operations.types.append")}</SelectItem>
                      <SelectItem value="prepend">{t("operations.types.prepend")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t("operations.keyLabel")}</Label>
                  <Input
                    placeholder={t("operations.keyPlaceholder")}
                    value={newOpKey}
                    onChange={(e) => setNewOpKey(e.target.value)}
                  />
                </div>

                {needsValue && (
                  <div className="space-y-2">
                    <Label>{t("operations.valueLabel")}</Label>
                    <Input
                      placeholder={t("operations.valuePlaceholder")}
                      value={newOpValue}
                      onChange={(e) => setNewOpValue(e.target.value)}
                    />
                  </div>
                )}

                <Button
                  className="w-full"
                  disabled={!newOpKey || (needsValue && !newOpValue)}
                  onClick={handleAddOperation}
                >
                  <Icon className="size-4" icon="lucide:plus" />
                  {t("operations.add")}
                </Button>
              </div>

              {operations.length > 0 && (
                <div className="space-y-2">
                  <Label>
                    {t("operations.list")} ({operations.length})
                  </Label>
                  <div className="space-y-1">
                    {operations.map((op) => (
                      <div key={op.id} className="flex items-center gap-2 rounded-md border p-2">
                        <Badge variant="secondary">{op.type}</Badge>
                        <code className="flex-1 truncate text-xs">
                          [{op.key}] {op.value ? `= ${op.value}` : ""}
                        </code>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => handleRemoveOperation(op.id)}
                        >
                          <Icon className="size-4 text-destructive" icon="lucide:x" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Checks */}
          <Card>
            <CardHeader>
              <CardTitle>{t("checks.title")}</CardTitle>
              <CardDescription>{t("checks.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>{t("checks.keyLabel")}</Label>
                  <Input
                    placeholder={t("checks.keyPlaceholder")}
                    value={newCheckKey}
                    onChange={(e) => setNewCheckKey(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t("checks.versionstampLabel")}</Label>
                  <Input
                    placeholder={t("checks.versionstampPlaceholder")}
                    value={newCheckVersionstamp}
                    onChange={(e) => setNewCheckVersionstamp(e.target.value)}
                  />
                </div>

                <Button className="w-full" disabled={!newCheckKey} onClick={handleAddCheck}>
                  <Icon className="size-4" icon="lucide:plus" />
                  {t("checks.add")}
                </Button>
              </div>

              {checks.length > 0 && (
                <div className="space-y-2">
                  <Label>
                    {t("checks.list")} ({checks.length})
                  </Label>
                  <div className="space-y-1">
                    {checks.map((check) => (
                      <div key={check.id} className="flex items-center gap-2 rounded-md border p-2">
                        <code className="flex-1 truncate text-xs">
                          [{check.key}] = {check.versionstamp || "null"}
                        </code>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => handleRemoveCheck(check.id)}
                        >
                          <Icon className="size-4 text-destructive" icon="lucide:x" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Execute Section */}
        <Card>
          <CardHeader>
            <CardTitle>{t("execute.title")}</CardTitle>
            <CardDescription>{t("execute.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={loading || (operations.length === 0 && checks.length === 0)}
                onClick={handleCommit}
              >
                {loading ? (
                  <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
                ) : (
                  <Icon className="size-4" icon="lucide:check-circle" />
                )}
                {t("execute.commit")}
              </Button>
              <Button variant="outline" onClick={handleClear}>
                <Icon className="size-4" icon="lucide:trash-2" />
                {t("execute.clear")}
              </Button>
            </div>

            {result && (
              <div className="space-y-2">
                <Label>{t("execute.resultLabel")}</Label>
                <div className="rounded-lg border p-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={result.ok ? "default" : "destructive"}>
                        {result.ok ? t("execute.success") : t("execute.failure")}
                      </Badge>
                    </div>
                    {result.ok && (
                      <pre className="text-xs">
                        {JSON.stringify(
                          {
                            versionstamp: result.versionstamp,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Operations Preview Table */}
        {operations.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>{t("preview.title")}</CardTitle>
              <CardDescription>{t("preview.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("preview.table.order")}</TableHead>
                    <TableHead>{t("preview.table.type")}</TableHead>
                    <TableHead>{t("preview.table.key")}</TableHead>
                    <TableHead>{t("preview.table.value")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operations.map((op, index) => (
                    <TableRow key={op.id}>
                      <TableCell>
                        <Badge variant="outline">{index + 1}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{op.type}</Badge>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs">[{op.key}]</code>
                      </TableCell>
                      <TableCell>
                        <code className="max-w-xs truncate text-xs">{op.value || "-"}</code>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}

export const Route = createFileRoute("/keyval/atomic/")({
  component: AtomicPage,
  loader: () => ({ breadcrumb: "keyval:nav.atomic" }),
});
