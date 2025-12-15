import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { api } from "~/utils/api";

interface DurableObject {
  className: string;
  createdAt: number;
  id: string;
  lastActiveAt: number;
}

interface DurableDetailProps {
  id: string;
  onBack: () => void;
  onDeleted: () => void;
}

export function DurableDetail({ id, onBack, onDeleted }: DurableDetailProps) {
  const { t } = useTranslation("durable");
  const [object, setObject] = useState<DurableObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const loadObject = async () => {
      setLoading(true);
      try {
        const response = await api.durable[":id"].$get({ param: { id } });
        if (response.ok) {
          const result = await response.json();
          setObject(result);
        }
      } catch (error) {
        console.error("Get error:", error);
      } finally {
        setLoading(false);
      }
    };

    loadObject();
  }, [id]);

  const handleDelete = useCallback(async () => {
    if (!confirm(t("detail.confirmDelete"))) return;

    setDeleting(true);
    try {
      await api.durable[":id"].$delete({ param: { id } });
      onDeleted();
    } catch (error) {
      console.error("Delete error:", error);
      setDeleting(false);
    }
  }, [id, onDeleted, t]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center">
        <Icon className="size-8 animate-spin text-muted-foreground" icon="lucide:loader-2" />
      </div>
    );
  }

  if (!object) {
    return (
      <div className="p-4 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("detail.notFound")}</h1>
        </div>
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">{t("detail.notFoundDescription")}</p>
            <Button className="mt-4" variant="outline" onClick={onBack}>
              <Icon className="size-4" icon="lucide:arrow-left" />
              {t("detail.backToList")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("detail.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("detail.description")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack}>
            <Icon className="size-4" icon="lucide:arrow-left" />
            {t("detail.backToList")}
          </Button>
          <Button disabled={deleting} variant="destructive" onClick={handleDelete}>
            {deleting ? (
              <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
            ) : (
              <Icon className="size-4" icon="lucide:trash-2" />
            )}
            {t("detail.delete")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("detail.info.title")}</CardTitle>
          <CardDescription>{t("detail.info.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-sm font-medium text-muted-foreground">{t("detail.info.id")}</div>
            <code className="mt-1 block rounded bg-muted p-2 font-mono text-sm">{object.id}</code>
          </div>

          <div>
            <div className="text-sm font-medium text-muted-foreground">
              {t("detail.info.className")}
            </div>
            <code className="mt-1 block rounded bg-muted p-2 font-mono text-sm">
              {object.className}
            </code>
          </div>

          <div>
            <div className="text-sm font-medium text-muted-foreground">
              {t("detail.info.createdAt")}
            </div>
            <div className="mt-1 text-sm">{formatDate(object.createdAt)}</div>
          </div>

          <div>
            <div className="text-sm font-medium text-muted-foreground">
              {t("detail.info.lastActiveAt")}
            </div>
            <div className="mt-1 text-sm">{formatDate(object.lastActiveAt)}</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
