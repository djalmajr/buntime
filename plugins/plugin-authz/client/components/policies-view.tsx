import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@buntime/shadcn-ui";
import { useEffect, useState } from "react";
import { basePath } from "~/utils/api";
import { Icon } from "./icon";

interface Action {
  method?: string;
  operation?: string;
}

interface Resource {
  app?: string;
  path?: string;
  type?: string;
}

interface Subject {
  group?: string;
  id?: string;
  role?: string;
}

interface Policy {
  actions: Action[];
  description?: string;
  effect: "deny" | "permit";
  id: string;
  name?: string;
  priority?: number;
  resources: Resource[];
  subjects: Subject[];
}

export function PoliciesView() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingPolicy, setEditingPolicy] = useState<Policy>({
    actions: [],
    effect: "permit",
    id: "",
    priority: 100,
    resources: [],
    subjects: [],
  });

  const [newMethod, setNewMethod] = useState("GET");
  const [newPath, setNewPath] = useState("");
  const [newRole, setNewRole] = useState("");

  const loadPolicies = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${basePath}/api/authz/policies`);
      const data = await response.json();
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
    if (!confirm("Are you sure you want to delete this policy?")) return;
    try {
      await fetch(`${basePath}/api/authz/policies/${id}`, { method: "DELETE" });
      await loadPolicies();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete policy");
    }
  };

  const handleSave = async () => {
    try {
      await fetch(`${basePath}/api/authz/policies`, {
        body: JSON.stringify(editingPolicy),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      await loadPolicies();
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

  const addAction = () => {
    setEditingPolicy({
      ...editingPolicy,
      actions: [...editingPolicy.actions, { method: newMethod }],
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

  const addRole = () => {
    if (!newRole.trim()) return;
    setEditingPolicy({
      ...editingPolicy,
      subjects: [...editingPolicy.subjects, { role: newRole.trim() }],
    });
    setNewRole("");
  };

  const removeAction = (index: number) => {
    setEditingPolicy({
      ...editingPolicy,
      actions: editingPolicy.actions.filter((_, i) => i !== index),
    });
  };

  const removeResource = (index: number) => {
    setEditingPolicy({
      ...editingPolicy,
      resources: editingPolicy.resources.filter((_, i) => i !== index),
    });
  };

  const removeSubject = (index: number) => {
    setEditingPolicy({
      ...editingPolicy,
      subjects: editingPolicy.subjects.filter((_, i) => i !== index),
    });
  };

  return (
    <div className="m-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Policies</h1>
          <p className="text-muted-foreground">Manage authorization policies</p>
        </div>
        <Button size="sm" onClick={loadPolicies}>
          <Icon className="mr-2 size-4" icon="lucide:refresh-cw" />
          Refresh
        </Button>
      </div>

      <Tabs className="w-full" defaultValue="list">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="create">Create</TabsTrigger>
        </TabsList>

        <TabsContent className="space-y-4" value="list">
          <Card>
            <CardHeader>
              <CardTitle>Policies</CardTitle>
              <CardDescription>All policies in the system</CardDescription>
            </CardHeader>
            <CardContent>
              {error && <p className="text-sm text-destructive">{error}</p>}
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading policies...</p>
              ) : policies.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No policies found. Create one to get started.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Effect</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Actions</TableHead>
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
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(policy.id)}>
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
            <Card>
              <CardHeader>
                <CardTitle>Create Policy</CardTitle>
                <CardDescription>Define a new authorization policy</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="policy-id">Policy ID</Label>
                  <Input
                    id="policy-id"
                    placeholder="my-policy"
                    value={editingPolicy.id}
                    onChange={(e) => setEditingPolicy({ ...editingPolicy, id: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="policy-name">Name</Label>
                  <Input
                    id="policy-name"
                    placeholder="My Policy"
                    value={editingPolicy.name || ""}
                    onChange={(e) => setEditingPolicy({ ...editingPolicy, name: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="policy-description">Description</Label>
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
                    <Label htmlFor="policy-effect">Effect</Label>
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
                        <SelectItem value="permit">Permit</SelectItem>
                        <SelectItem value="deny">Deny</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="policy-priority">Priority</Label>
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

                <div className="space-y-2">
                  <Label>Subjects</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="admin"
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

                <div className="space-y-2">
                  <Label>Resources</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="/api/users/*"
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
                          <button className="ml-1" type="button" onClick={() => removeResource(i)}>
                            <Icon className="size-3" icon="lucide:x" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Actions</Label>
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
                    <Button size="sm" type="button" onClick={addAction}>
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
                  Save Policy
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Policy Preview</CardTitle>
                <CardDescription>JSON representation of the policy</CardDescription>
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
  );
}
