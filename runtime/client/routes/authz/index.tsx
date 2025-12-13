import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ScrollArea } from "~/components/ui/scroll-area";
import { PageHeader } from "~/routes/-components/page-header";

const features = [
  {
    descriptionKey: "dashboard.policies.description",
    icon: "lucide:shield",
    path: "/authz/policies",
    titleKey: "dashboard.policies.title",
  },
  {
    descriptionKey: "dashboard.evaluate.description",
    icon: "lucide:check-circle",
    path: "/authz/evaluate",
    titleKey: "dashboard.evaluate.title",
  },
];

function DashboardPage() {
  const { t } = useTranslation("authz");

  return (
    <ScrollArea className="h-full">
      <div className="m-4 space-y-4">
        <PageHeader description={t("dashboard.subtitle")} title={t("dashboard.title")} />

        {/* Feature Cards */}
        <div className="grid gap-4 md:grid-cols-2">
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
              <code>{`// Define a policy
const policy = {
  id: "admin-only",
  name: "Admin Only Access",
  effect: "permit",
  priority: 100,
  subjects: [{ role: "admin" }],
  resources: [{ app: "myapp", path: "/admin/*" }],
  actions: [{ method: "GET" }]
};

// Create policy
await api.authz.policies.$post({ json: policy }).then(r => r.json());

// Evaluate access
const decision = await api.authz.evaluate.$post({
  json: {
    subject: { id: "user1", roles: ["admin"], groups: [], claims: {} },
    resource: { app: "myapp", path: "/admin/users" },
    action: { method: "GET" },
    environment: { ip: "192.168.1.1", time: new Date().toISOString() }
  }
}).then(r => r.json());

console.log(decision.effect); // "permit" or "deny"`}</code>
            </pre>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}

export const Route = createFileRoute("/authz/")({
  component: DashboardPage,
});
