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
  Separator,
} from "@zomme/shadcn-react";
import { useState } from "react";
import { basePath } from "~/utils/api";

interface Action {
  method: string;
  operation?: string;
}

interface Environment {
  ip: string;
  time: string;
}

interface Resource {
  app: string;
  path: string;
  type?: string;
}

interface Subject {
  claims: Record<string, unknown>;
  group?: string;
  groups: string[];
  id: string;
  role?: string;
  roles: string[];
}

interface EvaluationContext {
  action: Action;
  environment: Environment;
  resource: Resource;
  subject: Subject;
}

interface Decision {
  effect: string;
  matchedPolicy?: string;
  reason?: string;
}

interface PolicyMatch {
  effect: string;
  id: string;
  name?: string;
  priority?: number;
}

interface ExplainResponse {
  context: EvaluationContext;
  decision: Decision;
  policies: PolicyMatch[];
}

export function EvaluateView() {
  const [context, setContext] = useState<EvaluationContext>({
    action: {
      method: "GET",
    },
    environment: {
      ip: "192.168.1.1",
      time: new Date().toISOString(),
    },
    resource: {
      app: "myapp",
      path: "/api/users",
    },
    subject: {
      claims: {},
      groups: [],
      id: "user1",
      roles: [],
    },
  });

  const [decision, setDecision] = useState<Decision | null>(null);
  const [explanation, setExplanation] = useState<ExplainResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const handleEvaluate = async () => {
    setLoading(true);
    setDecision(null);
    setExplanation(null);
    try {
      const response = await fetch(`${basePath}/api/authz/evaluate`, {
        body: JSON.stringify(context),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = await response.json();
      setDecision(result);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to evaluate");
    } finally {
      setLoading(false);
    }
  };

  const handleExplain = async () => {
    setLoading(true);
    setDecision(null);
    setExplanation(null);
    try {
      const response = await fetch(`${basePath}/api/authz/explain`, {
        body: JSON.stringify(context),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = await response.json();
      setExplanation(result);
      setDecision(result.decision);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to explain");
    } finally {
      setLoading(false);
    }
  };

  const updateSubjectGroups = (value: string) => {
    const groups = value
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean);
    setContext({
      ...context,
      subject: { ...context.subject, groups },
    });
  };

  const updateSubjectRoles = (value: string) => {
    const roles = value
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    setContext({
      ...context,
      subject: { ...context.subject, roles },
    });
  };

  const getDecisionBadgeVariant = (effect: string) => {
    switch (effect) {
      case "permit":
        return "default";
      case "deny":
        return "destructive";
      default:
        return "secondary";
    }
  };

  return (
    <div className="m-4 space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Evaluate</h1>
        <p className="text-muted-foreground">Test policy evaluation with different contexts</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Evaluation Context</CardTitle>
            <CardDescription>Define the evaluation context</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-base font-semibold">Subject</Label>
              <div className="space-y-2">
                <div>
                  <Label htmlFor="subject-id">Subject ID</Label>
                  <Input
                    id="subject-id"
                    value={context.subject.id}
                    onChange={(e) =>
                      setContext({
                        ...context,
                        subject: { ...context.subject, id: e.target.value },
                      })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="subject-roles">Roles (comma-separated)</Label>
                  <Input
                    id="subject-roles"
                    placeholder="admin, user"
                    value={context.subject.roles.join(", ")}
                    onChange={(e) => updateSubjectRoles(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="subject-groups">Groups (comma-separated)</Label>
                  <Input
                    id="subject-groups"
                    placeholder="developers, admins"
                    value={context.subject.groups.join(", ")}
                    onChange={(e) => updateSubjectGroups(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label className="text-base font-semibold">Resource</Label>
              <div className="space-y-2">
                <div>
                  <Label htmlFor="resource-app">Application</Label>
                  <Input
                    id="resource-app"
                    value={context.resource.app}
                    onChange={(e) =>
                      setContext({
                        ...context,
                        resource: { ...context.resource, app: e.target.value },
                      })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="resource-path">Resource Path</Label>
                  <Input
                    id="resource-path"
                    value={context.resource.path}
                    onChange={(e) =>
                      setContext({
                        ...context,
                        resource: { ...context.resource, path: e.target.value },
                      })
                    }
                  />
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label className="text-base font-semibold">Action</Label>
              <div className="space-y-2">
                <div>
                  <Label htmlFor="action-method">HTTP Method</Label>
                  <Select
                    value={context.action.method}
                    onValueChange={(value: string) =>
                      setContext({
                        ...context,
                        action: { ...context.action, method: value },
                      })
                    }
                  >
                    <SelectTrigger id="action-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GET">GET</SelectItem>
                      <SelectItem value="POST">POST</SelectItem>
                      <SelectItem value="PUT">PUT</SelectItem>
                      <SelectItem value="DELETE">DELETE</SelectItem>
                      <SelectItem value="PATCH">PATCH</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label className="text-base font-semibold">Environment</Label>
              <div className="space-y-2">
                <div>
                  <Label htmlFor="environment-ip">IP Address</Label>
                  <Input
                    id="environment-ip"
                    value={context.environment.ip}
                    onChange={(e) =>
                      setContext({
                        ...context,
                        environment: { ...context.environment, ip: e.target.value },
                      })
                    }
                  />
                </div>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-2">
              <Button disabled={loading} onClick={handleEvaluate}>
                <Icon className="mr-2 size-4" icon="lucide:check-circle" />
                Evaluate
              </Button>
              <Button disabled={loading} variant="secondary" onClick={handleExplain}>
                <Icon className="mr-2 size-4" icon="lucide:info" />
                Explain
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {decision && (
            <Card>
              <CardHeader>
                <CardTitle>Decision</CardTitle>
                <CardDescription>Result of the policy evaluation</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Effect:</span>
                  <Badge variant={getDecisionBadgeVariant(decision.effect)}>
                    {decision.effect}
                  </Badge>
                </div>
                {decision.matchedPolicy && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Matched Policy:</span>
                    <code className="text-sm">{decision.matchedPolicy}</code>
                  </div>
                )}
                {decision.reason && (
                  <div className="space-y-1">
                    <span className="text-sm text-muted-foreground">Reason:</span>
                    <p className="text-sm">{decision.reason}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {explanation && (
            <Card>
              <CardHeader>
                <CardTitle>Explanation</CardTitle>
                <CardDescription>Detailed explanation of the decision</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {explanation.policies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No policies matched this request</p>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Matched Policies:</Label>
                    {explanation.policies.map((policy, i) => (
                      <div key={i} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <code className="font-mono text-sm">{policy.id}</code>
                              <Badge variant={getDecisionBadgeVariant(policy.effect)}>
                                {policy.effect}
                              </Badge>
                            </div>
                            {policy.name && (
                              <p className="text-sm text-muted-foreground">{policy.name}</p>
                            )}
                          </div>
                          {policy.priority !== undefined && (
                            <Badge variant="outline">Priority: {policy.priority}</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <Separator />

                <div className="space-y-1">
                  <Label className="text-sm font-semibold">Context Used:</Label>
                  <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
                    <code>{JSON.stringify(explanation.context, null, 2)}</code>
                  </pre>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
