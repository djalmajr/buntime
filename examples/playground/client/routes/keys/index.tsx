import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { kv } from "~/helpers/kv";
import { PageHeader } from "~/routes/-components/page-header";

interface KvEntry {
  key: (string | number)[];
  value: unknown;
  versionstamp: string | null;
}

function KeysPage() {
  const { t } = useTranslation("keys");
  const [entries, setEntries] = useState<KvEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [getKey, setGetKey] = useState("");
  const [getResult, setGetResult] = useState<KvEntry | null>(null);

  const handleList = useCallback(async () => {
    setLoading(true);
    try {
      const prefixParts = prefix ? prefix.split(",").map((p) => p.trim()) : [];
      const results: KvEntry[] = [];
      for await (const entry of kv.list(prefixParts)) {
        results.push(entry as KvEntry);
      }
      setEntries(results);
    } catch (error) {
      console.error("List error:", error);
    } finally {
      setLoading(false);
    }
  }, [prefix]);

  const handleGet = useCallback(async () => {
    setLoading(true);
    try {
      const keyParts = getKey.split(",").map((p) => p.trim());
      const result = await kv.get(keyParts);
      setGetResult(result as KvEntry);
    } catch (error) {
      console.error("Get error:", error);
    } finally {
      setLoading(false);
    }
  }, [getKey]);

  const handleSet = useCallback(async () => {
    setLoading(true);
    try {
      const keyParts = newKey.split(",").map((p) => p.trim());
      const value = JSON.parse(newValue);
      await kv.set(keyParts, value);
      await handleList();
      setNewKey("");
      setNewValue("");
    } catch (error) {
      console.error("Set error:", error);
    } finally {
      setLoading(false);
    }
  }, [newKey, newValue, handleList]);

  const handleDelete = useCallback(
    async (key: (string | number)[]) => {
      setLoading(true);
      try {
        await kv.delete(key, { exact: true });
        await handleList();
      } catch (error) {
        console.error("Delete error:", error);
      } finally {
        setLoading(false);
      }
    },
    [handleList],
  );

  return (
    <div className="space-y-6">
      <PageHeader description={t("description")} title={t("title")} />

      <Tabs defaultValue="browse">
        <TabsList>
          <TabsTrigger value="browse">
            <Icon className="size-4" icon="lucide:list" />
            {t("tabs.browse")}
          </TabsTrigger>
          <TabsTrigger value="get">
            <Icon className="size-4" icon="lucide:search" />
            {t("tabs.get")}
          </TabsTrigger>
          <TabsTrigger value="set">
            <Icon className="size-4" icon="lucide:plus" />
            {t("tabs.set")}
          </TabsTrigger>
        </TabsList>

        <TabsContent className="space-y-4" value="browse">
          <Card>
            <CardHeader>
              <CardTitle>{t("browse.title")}</CardTitle>
              <CardDescription>{t("browse.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder={t("browse.prefixPlaceholder")}
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                />
                <Button disabled={loading} onClick={handleList}>
                  {loading ? (
                    <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
                  ) : (
                    <Icon className="size-4" icon="lucide:refresh-cw" />
                  )}
                  {t("browse.list")}
                </Button>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("table.key")}</TableHead>
                    <TableHead>{t("table.value")}</TableHead>
                    <TableHead>{t("table.versionstamp")}</TableHead>
                    <TableHead className="w-[100px]">{t("table.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.length === 0 ? (
                    <TableRow>
                      <TableCell className="text-center text-muted-foreground" colSpan={4}>
                        {t("table.empty")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    entries.map((entry) => (
                      <TableRow key={JSON.stringify(entry.key)}>
                        <TableCell>
                          <code className="rounded bg-muted px-1 text-xs">
                            [{entry.key.map((k) => JSON.stringify(k)).join(", ")}]
                          </code>
                        </TableCell>
                        <TableCell>
                          <pre className="max-w-xs truncate text-xs">
                            {JSON.stringify(entry.value)}
                          </pre>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{entry.versionstamp?.slice(0, 8)}...</Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => handleDelete(entry.key)}
                          >
                            <Icon className="size-4 text-destructive" icon="lucide:trash-2" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="space-y-4" value="get">
          <Card>
            <CardHeader>
              <CardTitle>{t("get.title")}</CardTitle>
              <CardDescription>{t("get.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder={t("get.keyPlaceholder")}
                  value={getKey}
                  onChange={(e) => setGetKey(e.target.value)}
                />
                <Button disabled={loading || !getKey} onClick={handleGet}>
                  {loading ? (
                    <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
                  ) : (
                    <Icon className="size-4" icon="lucide:search" />
                  )}
                  {t("get.fetch")}
                </Button>
              </div>

              {getResult && (
                <pre className="rounded-lg bg-muted p-4 text-sm">
                  {JSON.stringify(getResult, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="space-y-4" value="set">
          <Card>
            <CardHeader>
              <CardTitle>{t("set.title")}</CardTitle>
              <CardDescription>{t("set.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label>{t("set.keyLabel")}</Label>
                  <Input
                    placeholder={t("set.keyPlaceholder")}
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("set.valueLabel")}</Label>
                  <Input
                    placeholder={t("set.valuePlaceholder")}
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                  />
                </div>
                <Button disabled={loading || !newKey || !newValue} onClick={handleSet}>
                  {loading ? (
                    <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
                  ) : (
                    <Icon className="size-4" icon="lucide:save" />
                  )}
                  {t("set.save")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export const Route = createFileRoute("/keys/")({
  component: KeysPage,
});
