import type { KvEntry, KvIndex, KvKey } from "@buntime/keyval";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@buntime/shadcn-ui";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { kv } from "~/helpers/kv";
import { PageHeader } from "./page-header";
import { ScrollArea } from "./scroll-area";

type Tokenizer = "ascii" | "porter" | "unicode61";

export function SearchView() {
  const { t } = useTranslation();
  const [indexes, setIndexes] = useState<KvIndex[]>([]);
  const [loading, setLoading] = useState(false);

  // Indexes tab state
  const [documentKey, setDocumentKey] = useState("");
  const [fields, setFields] = useState("");
  const [tokenizer, setTokenizer] = useState<Tokenizer>("unicode61");

  // Search tab state
  const [indexKey, setIndexKey] = useState("");
  const [query, setQuery] = useState("");
  const [highlightPrefix, setHighlightPrefix] = useState("<mark>");
  const [highlightSuffix, setHighlightSuffix] = useState("</mark>");
  const [proximity, setProximity] = useState("");
  const [searchResults, setSearchResults] = useState<KvEntry[]>([]);

  const loadIndexes = useCallback(async () => {
    try {
      const result = await kv.listIndexes();
      setIndexes(result);
    } catch (error) {
      console.error("List indexes error:", error);
    }
  }, []);

  useEffect(() => {
    loadIndexes();
  }, [loadIndexes]);

  const handleCreateIndex = useCallback(async () => {
    setLoading(true);
    try {
      const keyParts = documentKey.split("search.,").map((p) => p.trim());
      const fieldList = fields.split("search.,").map((f) => f.trim());

      await kv.createIndex(keyParts, {
        fields: fieldList,
        tokenize: tokenizer,
      });

      await loadIndexes();
      setDocumentKey("");
      setFields("");
      setTokenizer("unicode61");
    } catch (error) {
      console.error("Create index error:", error);
    } finally {
      setLoading(false);
    }
  }, [documentKey, fields, tokenizer, loadIndexes]);

  const handleRemoveIndex = useCallback(
    async (prefix: KvKey) => {
      setLoading(true);
      try {
        await kv.removeIndex(prefix);
        await loadIndexes();
      } catch (error) {
        console.error("Remove index error:", error);
      } finally {
        setLoading(false);
      }
    },
    [loadIndexes],
  );

  const handleSearch = useCallback(async () => {
    setLoading(true);
    try {
      const keyParts = indexKey.split("search.,").map((p) => p.trim());
      const results: KvEntry[] = [];

      for await (const entry of kv.search(keyParts, query)) {
        results.push(entry);
      }

      setSearchResults(results);
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setLoading(false);
    }
  }, [indexKey, query]);

  return (
    <ScrollArea className="h-full">
      <div className="m-4 space-y-4">
        <PageHeader description={t("search.description")} title={t("search.title")} />

        <Tabs defaultValue="indexes">
          <TabsList>
            <TabsTrigger value="indexes">
              <Icon className="size-4" icon="lucide:database" />
              {t("search.tabs.indexes")}
            </TabsTrigger>
            <TabsTrigger value="search">
              <Icon className="size-4" icon="lucide:search" />
              {t("search.tabs.search")}
            </TabsTrigger>
          </TabsList>

          <TabsContent className="space-y-4" value="indexes">
            <Card>
              <CardHeader>
                <CardTitle>{t("search.indexes.create.title")}</CardTitle>
                <CardDescription>{t("search.indexes.create.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <Label>{t("search.indexes.create.documentKeyLabel")}</Label>
                    <Input
                      placeholder={t("search.indexes.create.documentKeyPlaceholder")}
                      value={documentKey}
                      onChange={(e) => setDocumentKey(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("search.indexes.create.fieldsLabel")}</Label>
                    <Input
                      placeholder={t("search.indexes.create.fieldsPlaceholder")}
                      value={fields}
                      onChange={(e) => setFields(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("search.indexes.create.tokenizerLabel")}</Label>
                    <Select
                      value={tokenizer}
                      onValueChange={(val) => setTokenizer(val as Tokenizer)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unicode61">unicode61</SelectItem>
                        <SelectItem value="porter">porter</SelectItem>
                        <SelectItem value="ascii">ascii</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button disabled={loading || !documentKey || !fields} onClick={handleCreateIndex}>
                    {loading ? (
                      <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
                    ) : (
                      <Icon className="size-4" icon="lucide:plus" />
                    )}
                    {t("search.indexes.create.create")}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("search.indexes.list.title")}</CardTitle>
                <CardDescription>{t("search.indexes.list.description")}</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("search.indexes.list.table.prefix")}</TableHead>
                      <TableHead>{t("search.indexes.list.table.fields")}</TableHead>
                      <TableHead>{t("search.indexes.list.table.tokenizer")}</TableHead>
                      <TableHead className="w-[100px]">
                        {t("search.indexes.list.table.actions")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {indexes.length === 0 ? (
                      <TableRow>
                        <TableCell className="text-center text-muted-foreground" colSpan={4}>
                          {t("search.indexes.list.empty")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      indexes.map((index) => (
                        <TableRow key={JSON.stringify(index.prefix)}>
                          <TableCell>
                            <code className="rounded bg-muted px-1 text-xs">
                              [{index.prefix.map((k) => JSON.stringify(k)).join(", ")}]
                            </code>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {index.fields.map((field: string) => (
                                <Badge key={field} variant="outline">
                                  {field}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{index.tokenize}</Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => handleRemoveIndex(index.prefix)}
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

          <TabsContent className="space-y-4" value="search">
            <Card>
              <CardHeader>
                <CardTitle>{t("search.search.title")}</CardTitle>
                <CardDescription>{t("search.search.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <Label>{t("search.search.indexKeyLabel")}</Label>
                    <Input
                      placeholder={t("search.search.indexKeyPlaceholder")}
                      value={indexKey}
                      onChange={(e) => setIndexKey(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("search.search.queryLabel")}</Label>
                    <Input
                      placeholder={t("search.search.queryPlaceholder")}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{t("search.search.highlightPrefixLabel")}</Label>
                      <Input
                        placeholder={t("search.search.highlightPrefixPlaceholder")}
                        value={highlightPrefix}
                        onChange={(e) => setHighlightPrefix(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t("search.search.highlightSuffixLabel")}</Label>
                      <Input
                        placeholder={t("search.search.highlightSuffixPlaceholder")}
                        value={highlightSuffix}
                        onChange={(e) => setHighlightSuffix(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>{t("search.search.proximityLabel")}</Label>
                    <Input
                      placeholder={t("search.search.proximityPlaceholder")}
                      type="number"
                      value={proximity}
                      onChange={(e) => setProximity(e.target.value)}
                    />
                  </div>
                  <Button disabled={loading || !indexKey || !query} onClick={handleSearch}>
                    {loading ? (
                      <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
                    ) : (
                      <Icon className="size-4" icon="lucide:search" />
                    )}
                    {t("search.search.execute")}
                  </Button>
                </div>

                {searchResults.length > 0 && (
                  <div className="space-y-2">
                    <Label>
                      {t("search.search.results")} ({searchResults.length})
                    </Label>
                    <div className="space-y-2">
                      {searchResults.map((result) => (
                        <div
                          key={JSON.stringify(result.key)}
                          className="rounded-lg border bg-muted/50 p-3"
                        >
                          <div className="mb-2 flex items-start justify-between">
                            <code className="rounded bg-background px-2 py-1 text-xs">
                              [{result.key.map((k: unknown) => JSON.stringify(k)).join(", ")}]
                            </code>
                            {result.versionstamp && (
                              <Badge variant="outline">{result.versionstamp.slice(0, 8)}...</Badge>
                            )}
                          </div>
                          <pre className="text-sm">{JSON.stringify(result.value, null, 2)}</pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
}
