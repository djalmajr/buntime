import type { KvEntry, KvKey } from "@buntime/keyval";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "~/components/icon";
import { useKvGrid } from "~/components/kv-grid/hooks/use-kv-grid";
import { KvGrid } from "~/components/kv-grid/kv-grid";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { kv } from "~/helpers/kv";
import { PageHeader } from "~/routes/-components/page-header";

function parsePrefix(prefix: string): KvKey {
  if (!prefix.trim()) return [];
  return prefix.split(",").map((p) => {
    const trimmed = p.trim();
    const num = Number(trimmed);
    return Number.isNaN(num) ? trimmed : num;
  });
}

function EntriesPage() {
  const { t } = useTranslation("keyval.entries");

  // Browse tab state
  const [prefix, setPrefix] = useState("");
  const prefixParts = parsePrefix(prefix);
  const { deleteEntry, deleteMultiple, entries, loading, loadEntries, updateEntry } =
    useKvGrid(prefixParts);

  // Get tab state
  const [getKey, setGetKey] = useState("");
  const [getLoading, setGetLoading] = useState(false);
  const [getResult, setGetResult] = useState<KvEntry | null>(null);

  // Set tab state
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [setLoading, setSetLoading] = useState(false);

  const handleGet = useCallback(async () => {
    setGetLoading(true);
    try {
      const keyParts = parsePrefix(getKey);
      const result = await kv.get(keyParts);
      setGetResult(result as KvEntry);
    } catch (error) {
      console.error("Get error:", error);
    } finally {
      setGetLoading(false);
    }
  }, [getKey]);

  const handleSet = useCallback(async () => {
    setSetLoading(true);
    try {
      const keyParts = parsePrefix(newKey);
      const value = JSON.parse(newValue);
      await kv.set(keyParts, value);
      await loadEntries();
      setNewKey("");
      setNewValue("");
    } catch (error) {
      console.error("Set error:", error);
    } finally {
      setSetLoading(false);
    }
  }, [newKey, newValue, loadEntries]);

  return (
    <ScrollArea className="h-full">
      <div className="m-4 space-y-4">
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
                  <Button disabled={loading} onClick={loadEntries}>
                    {loading ? (
                      <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
                    ) : (
                      <Icon className="size-4" icon="lucide:search" />
                    )}
                    {t("browse.list")}
                  </Button>
                </div>

                <KvGrid
                  entries={entries}
                  loading={loading}
                  onDelete={deleteEntry}
                  onDeleteMultiple={deleteMultiple}
                  onEdit={updateEntry}
                  onRefresh={loadEntries}
                />
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
                  <Button disabled={getLoading || !getKey} onClick={handleGet}>
                    {getLoading ? (
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
                  <Button disabled={setLoading || !newKey || !newValue} onClick={handleSet}>
                    {setLoading ? (
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
    </ScrollArea>
  );
}

export const Route = createFileRoute("/keyval/entries/")({
  component: EntriesPage,
  loader: () => ({ breadcrumb: "keyval:nav.entries" }),
});
