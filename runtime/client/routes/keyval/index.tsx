import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ScrollArea } from "~/components/ui/scroll-area";
import { PageHeader } from "~/routes/-components/page-header";

const features = [
  {
    descriptionKey: "dashboard.entries.description",
    icon: "lucide:key",
    path: "/keyval/entries",
    titleKey: "dashboard.entries.title",
  },
  {
    descriptionKey: "dashboard.queue.description",
    icon: "lucide:list-todo",
    path: "/keyval/queue",
    titleKey: "dashboard.queue.title",
  },
  {
    descriptionKey: "dashboard.search.description",
    icon: "lucide:search",
    path: "/keyval/search",
    titleKey: "dashboard.search.title",
  },
  {
    descriptionKey: "dashboard.watch.description",
    icon: "lucide:eye",
    path: "/keyval/watch",
    titleKey: "dashboard.watch.title",
  },
  {
    descriptionKey: "dashboard.atomic.description",
    icon: "lucide:atom",
    path: "/keyval/atomic",
    titleKey: "dashboard.atomic.title",
  },
  {
    descriptionKey: "dashboard.metrics.description",
    icon: "lucide:activity",
    path: "/keyval/metrics",
    titleKey: "dashboard.metrics.title",
  },
];

function DashboardPage() {
  const { t } = useTranslation("keyval");

  return (
    <ScrollArea className="h-full">
      <div className="m-4 space-y-4">
        <PageHeader description={t("dashboard.subtitle")} title={t("dashboard.title")} />

        {/* Feature Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Link key={feature.path} to={feature.path}>
              <Card className="h-full transition-colors hover:bg-muted/50">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                      <Icon className="size-5 text-primary" icon={feature.icon} />
                    </div>
                    <CardTitle className="text-lg">{t(feature.titleKey)}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription>{t(feature.descriptionKey)}</CardDescription>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* Quick Info */}
        <Card>
          <CardHeader>
            <CardTitle>{t("quickStart.title")}</CardTitle>
            <CardDescription>{t("quickStart.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">
              <code>{`import { Kv } from "@buntime/keyval";

const kv = new Kv("/api/keyval");

// Set a value
await kv.set(["users", 1], { name: "Alice" });

// Get a value
const user = await kv.get(["users", 1]);

// List by prefix
for await (const entry of kv.list(["users"])) {
  console.log(entry.key, entry.value);
}`}</code>
            </pre>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}

export const Route = createFileRoute("/keyval/")({
  component: DashboardPage,
});
