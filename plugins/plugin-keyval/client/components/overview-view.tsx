import { useTranslation } from "react-i18next";
import { Icon } from "./icon";
import { PageHeader } from "./page-header";
import { ScrollArea } from "./scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

const features = [
  {
    descriptionKey: "dashboard.entries.description",
    icon: "lucide:key",
    path: "entries",
    titleKey: "dashboard.entries.title",
  },
  {
    descriptionKey: "dashboard.queue.description",
    icon: "lucide:list-todo",
    path: "queue",
    titleKey: "dashboard.queue.title",
  },
  {
    descriptionKey: "dashboard.search.description",
    icon: "lucide:search",
    path: "search",
    titleKey: "dashboard.search.title",
  },
  {
    descriptionKey: "dashboard.watch.description",
    icon: "lucide:eye",
    path: "watch",
    titleKey: "dashboard.watch.title",
  },
  {
    descriptionKey: "dashboard.atomic.description",
    icon: "lucide:atom",
    path: "atomic",
    titleKey: "dashboard.atomic.title",
  },
  {
    descriptionKey: "dashboard.metrics.description",
    icon: "lucide:activity",
    path: "metrics",
    titleKey: "dashboard.metrics.title",
  },
];

export function OverviewView() {
  const { t } = useTranslation();

  const handleNavigate = (path: string) => {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  return (
    <ScrollArea className="h-full">
      <div className="m-4 space-y-4">
        <PageHeader description={t("dashboard.subtitle")} title={t("dashboard.title")} />

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <button
              key={feature.path}
              className="cursor-pointer text-left"
              type="button"
              onClick={() => handleNavigate(feature.path)}
            >
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
            </button>
          ))}
        </div>

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
