import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { api } from "~/utils/api";

interface DurableObject {
  className: string;
  createdAt: number;
  id: string;
  lastActiveAt: number;
}

interface DurableListProps {
  loading: boolean;
  objects: DurableObject[];
  onRefresh: () => Promise<void>;
  onSelect: (id: string) => void;
}

export function DurableList({ loading, objects, onRefresh, onSelect }: DurableListProps) {
  const { t } = useTranslation("durable");

  const handleDelete = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      if (!confirm(t("list.confirmDelete"))) return;

      try {
        await api.durable[":id"].$delete({ param: { id } });
        await onRefresh();
      } catch (error) {
        console.error("Delete error:", error);
      }
    },
    [onRefresh, t],
  );

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("list.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("list.description")}</p>
        </div>
        <Button disabled={loading} onClick={onRefresh}>
          {loading ? (
            <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
          ) : (
            <Icon className="size-4" icon="lucide:refresh-cw" />
          )}
          {t("list.refresh")}
        </Button>
      </div>

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
                  <TableRow
                    key={obj.id}
                    className="cursor-pointer"
                    onClick={() => onSelect(obj.id)}
                  >
                    <TableCell>
                      <span className="font-mono text-xs text-primary hover:underline">
                        {obj.id}
                      </span>
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
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={(e) => handleDelete(e, obj.id)}
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
    </div>
  );
}
