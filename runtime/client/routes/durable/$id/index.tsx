import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ScrollArea } from "~/components/ui/scroll-area";
import { api } from "~/helpers/api-client";

import { PageHeader } from "~/routes/-components/page-header";

interface DurableObject {
  className: string;
  createdAt: number;
  id: string;
  lastActiveAt: number;
}

function DurableDetailPage() {
  const { t } = useTranslation("durable");
  const { id } = useParams({ from: "/durable/$id/" });
  const navigate = useNavigate();
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
      await navigate({ to: "/durable" });
    } catch (error) {
      console.error("Delete error:", error);
      setDeleting(false);
    }
  }, [id, navigate, t]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  if (loading) {
    return (
      <ScrollArea className="h-full">
        <div className="m-4 flex items-center justify-center">
          <Icon className="size-8 animate-spin text-muted-foreground" icon="lucide:loader-2" />
        </div>
      </ScrollArea>
    );
  }

  if (!object) {
    return (
      <ScrollArea className="h-full">
        <div className="m-4 space-y-4">
          <PageHeader title={t("detail.notFound")} />
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">{t("detail.notFoundDescription")}</p>
              <Link to="/durable">
                <Button className="mt-4" variant="outline">
                  <Icon className="size-4" icon="lucide:arrow-left" />
                  {t("detail.backToList")}
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="m-4 space-y-4">
        <PageHeader
          description={t("detail.description")}
          title={t("detail.title")}
          actions={
            <div className="flex gap-2">
              <Link to="/durable">
                <Button variant="outline">
                  <Icon className="size-4" icon="lucide:arrow-left" />
                  {t("detail.backToList")}
                </Button>
              </Link>
              <Button disabled={deleting} variant="destructive" onClick={handleDelete}>
                {deleting ? (
                  <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
                ) : (
                  <Icon className="size-4" icon="lucide:trash-2" />
                )}
                {t("detail.delete")}
              </Button>
            </div>
          }
        />

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
    </ScrollArea>
  );
}

export const Route = createFileRoute("/durable/$id/")({
  component: DurableDetailPage,
  loader: () => ({ breadcrumb: "durable:nav.detail" }),
});
