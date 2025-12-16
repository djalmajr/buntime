import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@buntime/shadcn-ui";
import { Icon } from "./icon";

interface OverviewViewProps {
  onNavigate: (path: string) => void;
}

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

export function OverviewView({ onNavigate }: OverviewViewProps) {
  return (
    <div className="m-4 space-y-4">
      <div>
        <h1 className="text-3xl font-bold">AuthZ Playground</h1>
        <p className="text-muted-foreground">Test all AuthZ SDK features interactively</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {features.map((feature) => (
          <button
            key={feature.path}
            className="cursor-pointer text-left"
            type="button"
            onClick={() => onNavigate(feature.path)}
          >
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="size-5 text-primary" icon={feature.icon} />
                  </div>
                  <CardTitle className="text-lg">
                    {feature.titleKey === "dashboard.policies.title" ? "Policies" : "Evaluate"}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  {feature.descriptionKey === "dashboard.policies.description"
                    ? "Create and manage authorization policies"
                    : "Test policy evaluation with different contexts"}
                </CardDescription>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick Start</CardTitle>
          <CardDescription>Get started with AuthZ in your application</CardDescription>
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
  );
}
