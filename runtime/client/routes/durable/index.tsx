import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { api } from "~/helpers/api-client";
import { PageHeader } from "~/routes/-components/page-header";

interface DurableObject {
  className: string;
  createdAt: number;
  id: string;
  lastActiveAt: number;
}

function DurableListPage() {
  const { t } = useTranslation("durable");
  const [objects, setObjects] = useState<DurableObject[]>([]);
  const [loading, setLoading] = useState(false);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.durable.index.$get();
      const results = await response.json();
      setObjects(results);
    } catch (error) {
      console.error("List error:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm(t("list.confirmDelete"))) return;

      setLoading(true);
      try {
        await api.durable[":id"].$delete({ param: { id } });
        await handleRefresh();
      } catch (error) {
        console.error("Delete error:", error);
      } finally {
        setLoading(false);
      }
    },
    [handleRefresh, t],
  );

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <ScrollArea className="h-full">
      <div className="m-4 space-y-4">
        <PageHeader
          description={t("list.description")}
          title={t("list.title")}
          actions={
            <Button disabled={loading} onClick={handleRefresh}>
              {loading ? (
                <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
              ) : (
                <Icon className="size-4" icon="lucide:refresh-cw" />
              )}
              {t("list.refresh")}
            </Button>
          }
        />

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("list.table.id")}</TableHead>
                  <TableHead>{t("list.table.className")}</TableHead>
                  <TableHead>{t("list.table.createdAt")}</TableHead>
                  <TableHead>{t("list.table.lastActiveAt")}</TableHead>
                  <TableHead className="w-[100px]">{t("list.table.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {objects.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-center text-muted-foreground" colSpan={5}>
                      {t("list.table.empty")}
                    </TableCell>
                  </TableRow>
                ) : (
                  objects.map((obj) => (
                    <TableRow key={obj.id}>
                      <TableCell>
                        <Link
                          className="font-mono text-xs text-primary hover:underline"
                          to="/durable/$id"
                          params={{ id: obj.id }}
                        >
                          {obj.id}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <code className="rounded bg-muted px-2 py-1 text-xs">{obj.className}</code>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(obj.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(obj.lastActiveAt)}
                      </TableCell>
                      <TableCell>
                        <Button size="icon-sm" variant="ghost" onClick={() => handleDelete(obj.id)}>
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
      </div>
    </ScrollArea>
  );
}

export const Route = createFileRoute("/durable/")({
  component: DurableListPage,
});
