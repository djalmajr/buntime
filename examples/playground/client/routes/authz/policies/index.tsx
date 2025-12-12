import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import type { Policy } from "~/helpers/authz-api";
import { authzApi } from "~/helpers/authz-api";
import { PageHeader } from "~/routes/-components/page-header";

function PoliciesPage() {
  const { t } = useTranslation("authz/policies");
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [editingPolicy, setEditingPolicy] = useState<Policy>({
    actions: [],
    effect: "permit",
    id: "",
    priority: 100,
    resources: [],
    subjects: [],
  });

  const [newRole, setNewRole] = useState("");
  const [newPath, setNewPath] = useState("");
  const [newMethod, setNewMethod] = useState("GET");

  const loadPolicies = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await authzApi.listPolicies();
      setPolicies(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load policies");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPolicies();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm(t("list.confirmDelete"))) return;
    try {
      await authzApi.deletePolicy(id);
      await loadPolicies();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete policy");
    }
  };

  const handleSave = async () => {
    try {
      await authzApi.createPolicy(editingPolicy);
      await loadPolicies();
      // Reset form
      setEditingPolicy({
        actions: [],
        effect: "permit",
        id: "",
        priority: 100,
        resources: [],
        subjects: [],
      });
      setNewRole("");
      setNewPath("");
      setNewMethod("GET");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save policy");
    }
  };

  const addRole = () => {
    if (!newRole.trim()) return;
    setEditingPolicy({
      ...editingPolicy,
      subjects: [...editingPolicy.subjects, { role: newRole.trim() }],
    });
    setNewRole("");
  };

  const removeSubject = (index: number) => {
    setEditingPolicy({
      ...editingPolicy,
      subjects: editingPolicy.subjects.filter((_, i) => i !== index),
    });
  };

  const addPath = () => {
    if (!newPath.trim()) return;
    setEditingPolicy({
      ...editingPolicy,
      resources: [...editingPolicy.resources, { path: newPath.trim() }],
    });
    setNewPath("");
  };

  const removeResource = (index: number) => {
    setEditingPolicy({
      ...editingPolicy,
      resources: editingPolicy.resources.filter((_, i) => i !== index),
    });
  };

  const addMethod = () => {
    setEditingPolicy({
      ...editingPolicy,
      actions: [...editingPolicy.actions, { method: newMethod }],
    });
  };

  const removeAction = (index: number) => {
    setEditingPolicy({
      ...editingPolicy,
      actions: editingPolicy.actions.filter((_, i) => i !== index),
    });
  };

  return (
    <ScrollArea className="h-full">
      <div className="m-4 space-y-4">
        <PageHeader
          actions={
            <Button size="sm" onClick={loadPolicies}>
              <Icon className="mr-2 size-4" icon="lucide:refresh-cw" />
              {t("list.refresh")}
            </Button>
          }
          description={t("list.subtitle")}
          title={t("list.title")}
        />

        <Tabs className="w-full" defaultValue="list">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="list">{t("tabs.list")}</TabsTrigger>
            <TabsTrigger value="create">{t("tabs.create")}</TabsTrigger>
          </TabsList>

          <TabsContent className="space-y-4" value="list">
            <Card>
              <CardHeader>
                <CardTitle>{t("list.policies")}</CardTitle>
                <CardDescription>{t("list.policiesDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                {error && <p className="text-sm text-destructive">{error}</p>}
                {loading ? (
                  <p className="text-sm text-muted-foreground">{t("list.loading")}</p>
                ) : policies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("list.noPolicies")}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("list.table.id")}</TableHead>
                        <TableHead>{t("list.table.name")}</TableHead>
                        <TableHead>{t("list.table.effect")}</TableHead>
                        <TableHead>{t("list.table.priority")}</TableHead>
                        <TableHead>{t("list.table.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {policies.map((policy) => (
                        <TableRow key={policy.id}>
                          <TableCell className="font-mono text-xs">{policy.id}</TableCell>
                          <TableCell>{policy.name || "-"}</TableCell>
                          <TableCell>
                            <Badge variant={policy.effect === "permit" ? "default" : "destructive"}>
                              {policy.effect}
                            </Badge>
                          </TableCell>
                          <TableCell>{policy.priority ?? "-"}</TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDelete(policy.id)}
                            >
                              <Icon className="size-4" icon="lucide:trash-2" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent className="space-y-4" value="create">
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Form */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("create.title")}</CardTitle>
                  <CardDescription>{t("create.subtitle")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Basic Info */}
                  <div className="space-y-2">
                    <Label htmlFor="policy-id">{t("create.fields.id")}</Label>
                    <Input
                      id="policy-id"
                      placeholder="my-policy"
                      value={editingPolicy.id}
                      onChange={(e) => setEditingPolicy({ ...editingPolicy, id: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="policy-name">{t("create.fields.name")}</Label>
                    <Input
                      id="policy-name"
                      placeholder="My Policy"
                      value={editingPolicy.name || ""}
                      onChange={(e) => setEditingPolicy({ ...editingPolicy, name: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="policy-description">{t("create.fields.description")}</Label>
                    <Input
                      id="policy-description"
                      placeholder="Policy description"
                      value={editingPolicy.description || ""}
                      onChange={(e) =>
                        setEditingPolicy({ ...editingPolicy, description: e.target.value })
                      }
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <Label htmlFor="policy-effect">{t("create.fields.effect")}</Label>
                      <Select
                        value={editingPolicy.effect}
                        onValueChange={(value: "deny" | "permit") =>
                          setEditingPolicy({ ...editingPolicy, effect: value })
                        }
                      >
                        <SelectTrigger id="policy-effect">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="permit">{t("create.fields.permit")}</SelectItem>
                          <SelectItem value="deny">{t("create.fields.deny")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="policy-priority">{t("create.fields.priority")}</Label>
                      <Input
                        id="policy-priority"
                        type="number"
                        value={editingPolicy.priority || 100}
                        onChange={(e) =>
                          setEditingPolicy({
                            ...editingPolicy,
                            priority: Number.parseInt(e.target.value, 10),
                          })
                        }
                      />
                    </div>
                  </div>

                  <Separator />

                  {/* Subjects */}
                  <div className="space-y-2">
                    <Label>{t("create.sections.subjects")}</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder={t("create.placeholders.role")}
                        value={newRole}
                        onChange={(e) => setNewRole(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addRole()}
                      />
                      <Button size="sm" type="button" onClick={addRole}>
                        <Icon className="size-4" icon="lucide:plus" />
                      </Button>
                    </div>
                    {editingPolicy.subjects.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-2">
                        {editingPolicy.subjects.map((subject, i) => (
                          <Badge key={i} variant="secondary">
                            {subject.role || subject.id || subject.group}
                            <button className="ml-1" type="button" onClick={() => removeSubject(i)}>
                              <Icon className="size-3" icon="lucide:x" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Resources */}
                  <div className="space-y-2">
                    <Label>{t("create.sections.resources")}</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder={t("create.placeholders.path")}
                        value={newPath}
                        onChange={(e) => setNewPath(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addPath()}
                      />
                      <Button size="sm" type="button" onClick={addPath}>
                        <Icon className="size-4" icon="lucide:plus" />
                      </Button>
                    </div>
                    {editingPolicy.resources.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-2">
                        {editingPolicy.resources.map((resource, i) => (
                          <Badge key={i} variant="secondary">
                            {resource.path || resource.app || resource.type}
                            <button
                              className="ml-1"
                              type="button"
                              onClick={() => removeResource(i)}
                            >
                              <Icon className="size-3" icon="lucide:x" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="space-y-2">
                    <Label>{t("create.sections.actions")}</Label>
                    <div className="flex gap-2">
                      <Select value={newMethod} onValueChange={setNewMethod}>
                        <SelectTrigger>
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
                      <Button size="sm" type="button" onClick={addMethod}>
                        <Icon className="size-4" icon="lucide:plus" />
                      </Button>
                    </div>
                    {editingPolicy.actions.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-2">
                        {editingPolicy.actions.map((action, i) => (
                          <Badge key={i} variant="secondary">
                            {action.method || action.operation}
                            <button className="ml-1" type="button" onClick={() => removeAction(i)}>
                              <Icon className="size-3" icon="lucide:x" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <Separator />

                  <Button className="w-full" onClick={handleSave}>
                    <Icon className="mr-2 size-4" icon="lucide:save" />
                    {t("create.save")}
                  </Button>
                </CardContent>
              </Card>

              {/* JSON Preview */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("create.preview.title")}</CardTitle>
                  <CardDescription>{t("create.preview.subtitle")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs">
                    <code>{JSON.stringify(editingPolicy, null, 2)}</code>
                  </pre>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
}

export const Route = createFileRoute("/authz/policies/")({
  component: PoliciesPage,
});
