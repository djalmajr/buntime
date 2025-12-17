import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Icon,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@buntime/shadcn-ui";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { kv } from "~/helpers/kv";
import { PageHeader } from "../../components/page-header";
import { ScrollArea } from "../../components/scroll-area";

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

export function AtomicView() {
  const { t } = useTranslation();
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
        const keyParts = check.key.split("atomic.,").map((p) => p.trim());
        const versionstamp = check.versionstamp === "" ? null : check.versionstamp;
        atomic = atomic.check({ key: keyParts, versionstamp });
      }

      // Add operations
      for (const op of operations) {
        const keyParts = op.key.split("atomic.,").map((p) => p.trim());

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
        <PageHeader description={t("atomic.description")} title={t("atomic.title")} />

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Operations Builder */}
          <Card>
            <CardHeader>
              <CardTitle>{t("atomic.operations.title")}</CardTitle>
              <CardDescription>{t("atomic.operations.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>{t("atomic.operations.typeLabel")}</Label>
                  <Select
                    value={newOpType}
                    onValueChange={(value) => setNewOpType(value as OperationType)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="set">{t("atomic.operations.types.set")}</SelectItem>
                      <SelectItem value="delete">{t("atomic.operations.types.delete")}</SelectItem>
                      <SelectItem value="sum">{t("atomic.operations.types.sum")}</SelectItem>
                      <SelectItem value="max">{t("atomic.operations.types.max")}</SelectItem>
                      <SelectItem value="min">{t("atomic.operations.types.min")}</SelectItem>
                      <SelectItem value="append">{t("atomic.operations.types.append")}</SelectItem>
                      <SelectItem value="prepend">
                        {t("atomic.operations.types.prepend")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t("atomic.operations.keyLabel")}</Label>
                  <Input
                    placeholder={t("atomic.operations.keyPlaceholder")}
                    value={newOpKey}
                    onChange={(e) => setNewOpKey(e.target.value)}
                  />
                </div>

                {needsValue && (
                  <div className="space-y-2">
                    <Label>{t("atomic.operations.valueLabel")}</Label>
                    <Input
                      placeholder={t("atomic.operations.valuePlaceholder")}
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
                  {t("atomic.operations.add")}
                </Button>
              </div>

              {operations.length > 0 && (
                <div className="space-y-2">
                  <Label>
                    {t("atomic.operations.list")} ({operations.length})
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
              <CardTitle>{t("atomic.checks.title")}</CardTitle>
              <CardDescription>{t("atomic.checks.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>{t("atomic.checks.keyLabel")}</Label>
                  <Input
                    placeholder={t("atomic.checks.keyPlaceholder")}
                    value={newCheckKey}
                    onChange={(e) => setNewCheckKey(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t("atomic.checks.versionstampLabel")}</Label>
                  <Input
                    placeholder={t("atomic.checks.versionstampPlaceholder")}
                    value={newCheckVersionstamp}
                    onChange={(e) => setNewCheckVersionstamp(e.target.value)}
                  />
                </div>

                <Button className="w-full" disabled={!newCheckKey} onClick={handleAddCheck}>
                  <Icon className="size-4" icon="lucide:plus" />
                  {t("atomic.checks.add")}
                </Button>
              </div>

              {checks.length > 0 && (
                <div className="space-y-2">
                  <Label>
                    {t("atomic.checks.list")} ({checks.length})
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
            <CardTitle>{t("atomic.execute.title")}</CardTitle>
            <CardDescription>{t("atomic.execute.description")}</CardDescription>
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
                {t("atomic.execute.commit")}
              </Button>
              <Button variant="outline" onClick={handleClear}>
                <Icon className="size-4" icon="lucide:trash-2" />
                {t("atomic.execute.clear")}
              </Button>
            </div>

            {result && (
              <div className="space-y-2">
                <Label>{t("atomic.execute.resultLabel")}</Label>
                <div className="rounded-lg border p-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={result.ok ? "default" : "destructive"}>
                        {result.ok ? t("atomic.execute.success") : t("atomic.execute.failure")}
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
              <CardTitle>{t("atomic.preview.title")}</CardTitle>
              <CardDescription>{t("atomic.preview.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("atomic.preview.table.order")}</TableHead>
                    <TableHead>{t("atomic.preview.table.type")}</TableHead>
                    <TableHead>{t("atomic.preview.table.key")}</TableHead>
                    <TableHead>{t("atomic.preview.table.value")}</TableHead>
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
