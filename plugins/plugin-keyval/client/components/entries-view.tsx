import type { KvEntry, KvKey } from "@buntime/keyval";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Icon,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@buntime/shadcn-ui";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { kv } from "~/helpers/kv";
import { useKvGrid } from "./kv-grid/hooks/use-kv-grid";
import { KvGrid } from "./kv-grid/kv-grid";
import { PageHeader } from "./page-header";
import { ScrollArea } from "./scroll-area";

function parsePrefix(prefix: string): KvKey {
  if (!prefix.trim()) return [];
  return prefix.split(",").map((p) => {
    const trimmed = p.trim();
    const num = Number(trimmed);
    return Number.isNaN(num) ? trimmed : num;
  });
}

export function EntriesView() {
  const { t } = useTranslation();

  const [prefix, setPrefix] = useState("");
  const prefixParts = parsePrefix(prefix);
  const { deleteEntry, deleteMultiple, entries, loading, loadEntries, updateEntry } =
    useKvGrid(prefixParts);

  const [getKey, setGetKey] = useState("");
  const [getLoading, setGetLoading] = useState(false);
  const [getResult, setGetResult] = useState<KvEntry | null>(null);

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
        <PageHeader description={t("entries.description")} title={t("entries.title")} />

        <Tabs defaultValue="browse">
          <TabsList>
            <TabsTrigger value="browse">
              <Icon className="size-4" icon="lucide:list" />
              {t("entries.tabs.browse")}
            </TabsTrigger>
            <TabsTrigger value="get">
              <Icon className="size-4" icon="lucide:search" />
              {t("entries.tabs.get")}
            </TabsTrigger>
            <TabsTrigger value="set">
              <Icon className="size-4" icon="lucide:plus" />
              {t("entries.tabs.set")}
            </TabsTrigger>
          </TabsList>

          <TabsContent className="space-y-4" value="browse">
            <Card>
              <CardHeader>
                <CardTitle>{t("entries.browse.title")}</CardTitle>
                <CardDescription>{t("entries.browse.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder={t("entries.browse.prefixPlaceholder")}
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                  />
                  <Button disabled={loading} onClick={loadEntries}>
                    {loading ? (
                      <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
                    ) : (
                      <Icon className="size-4" icon="lucide:search" />
                    )}
                    {t("entries.browse.list")}
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
                <CardTitle>{t("entries.get.title")}</CardTitle>
                <CardDescription>{t("entries.get.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder={t("entries.get.keyPlaceholder")}
                    value={getKey}
                    onChange={(e) => setGetKey(e.target.value)}
                  />
                  <Button disabled={getLoading || !getKey} onClick={handleGet}>
                    {getLoading ? (
                      <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
                    ) : (
                      <Icon className="size-4" icon="lucide:search" />
                    )}
                    {t("entries.get.fetch")}
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
                <CardTitle>{t("entries.set.title")}</CardTitle>
                <CardDescription>{t("entries.set.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <Label>{t("entries.set.keyLabel")}</Label>
                    <Input
                      placeholder={t("entries.set.keyPlaceholder")}
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("entries.set.valueLabel")}</Label>
                    <Input
                      placeholder={t("entries.set.valuePlaceholder")}
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
                    {t("entries.set.save")}
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
