import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import type { Decision, EvaluationContext, ExplainResponse } from "~/helpers/authz-api";
import { authzApi } from "~/helpers/authz-api";
import { PageHeader } from "~/routes/-components/page-header";

function EvaluatePage() {
  const { t } = useTranslation("authz/evaluate");

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
      const result = await authzApi.evaluate(context);
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
      const result = await authzApi.explain(context);
      setExplanation(result);
      setDecision(result.decision);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to explain");
    } finally {
      setLoading(false);
    }
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
    <ScrollArea className="h-full">
      <div className="m-4 space-y-4">
        <PageHeader description={t("subtitle")} title={t("title")} />

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Evaluation Context Form */}
          <Card>
            <CardHeader>
              <CardTitle>{t("form.title")}</CardTitle>
              <CardDescription>{t("form.subtitle")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Subject */}
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("form.subject.title")}</Label>
                <div className="space-y-2">
                  <div>
                    <Label htmlFor="subject-id">{t("form.subject.id")}</Label>
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
                    <Label htmlFor="subject-roles">{t("form.subject.roles")}</Label>
                    <Input
                      id="subject-roles"
                      placeholder="admin, user"
                      value={context.subject.roles.join(", ")}
                      onChange={(e) => updateSubjectRoles(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="subject-groups">{t("form.subject.groups")}</Label>
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

              {/* Resource */}
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("form.resource.title")}</Label>
                <div className="space-y-2">
                  <div>
                    <Label htmlFor="resource-app">{t("form.resource.app")}</Label>
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
                    <Label htmlFor="resource-path">{t("form.resource.path")}</Label>
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

              {/* Action */}
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("form.action.title")}</Label>
                <div className="space-y-2">
                  <div>
                    <Label htmlFor="action-method">{t("form.action.method")}</Label>
                    <Select
                      value={context.action.method}
                      onValueChange={(value) =>
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

              {/* Environment */}
              <div className="space-y-2">
                <Label className="text-base font-semibold">{t("form.environment.title")}</Label>
                <div className="space-y-2">
                  <div>
                    <Label htmlFor="environment-ip">{t("form.environment.ip")}</Label>
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

              {/* Actions */}
              <div className="grid grid-cols-2 gap-2">
                <Button disabled={loading} onClick={handleEvaluate}>
                  <Icon className="mr-2 size-4" icon="lucide:check-circle" />
                  {t("form.evaluate")}
                </Button>
                <Button disabled={loading} variant="secondary" onClick={handleExplain}>
                  <Icon className="mr-2 size-4" icon="lucide:info" />
                  {t("form.explain")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Results */}
          <div className="space-y-4">
            {/* Decision */}
            {decision && (
              <Card>
                <CardHeader>
                  <CardTitle>{t("results.decision.title")}</CardTitle>
                  <CardDescription>{t("results.decision.subtitle")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {t("results.decision.effect")}:
                    </span>
                    <Badge variant={getDecisionBadgeVariant(decision.effect)}>
                      {decision.effect}
                    </Badge>
                  </div>
                  {decision.matchedPolicy && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {t("results.decision.matchedPolicy")}:
                      </span>
                      <code className="text-sm">{decision.matchedPolicy}</code>
                    </div>
                  )}
                  {decision.reason && (
                    <div className="space-y-1">
                      <span className="text-sm text-muted-foreground">
                        {t("results.decision.reason")}:
                      </span>
                      <p className="text-sm">{decision.reason}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Explanation */}
            {explanation && (
              <Card>
                <CardHeader>
                  <CardTitle>{t("results.explanation.title")}</CardTitle>
                  <CardDescription>{t("results.explanation.subtitle")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {explanation.policies.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t("results.explanation.noPolicies")}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold">
                        {t("results.explanation.matchedPolicies")}:
                      </Label>
                      {explanation.policies.map((policy, i) => (
                        <div key={i} className="rounded-lg border p-3">
                          <div className="flex items-center justify-between">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <code className="text-sm font-mono">{policy.id}</code>
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
                    <Label className="text-sm font-semibold">
                      {t("results.explanation.contextUsed")}:
                    </Label>
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
    </ScrollArea>
  );
}

export const Route = createFileRoute("/authz/evaluate/")({
  component: EvaluatePage,
});
