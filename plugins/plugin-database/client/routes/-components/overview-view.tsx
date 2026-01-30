import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Icon } from "~/components/ui/icon";
import { api } from "../../helpers/api";

interface AdapterHealth {
  adapters?: Record<string, string>;
  default?: string;
  error?: string;
  status: string;
  types?: string[];
}

export function OverviewView() {
  const [health, setHealth] = useState<AdapterHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const loadHealth = useCallback(async () => {
    setLoading(true);
    try {
      const [healthData, adaptersData] = await Promise.all([api.getHealth(), api.getAdapters()]);
      setHealth({
        ...healthData,
        default: adaptersData.default,
        types: adaptersData.adapters,
      });
    } catch (error) {
      setHealth({
        error: error instanceof Error ? error.message : "Unknown error",
        status: "error",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Database</h1>
            <p className="text-muted-foreground">Multi-tenant database management</p>
          </div>
          <Button disabled={loading} variant="outline" onClick={loadHealth}>
            <Icon
              className={loading ? "size-4 animate-spin" : "size-4"}
              icon={loading ? "lucide:loader-2" : "lucide:refresh-cw"}
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* Studio Card */}
          <Link to="/studio">
            <Card className="h-full cursor-pointer transition-colors hover:bg-muted/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="size-5 text-primary" icon="lucide:table-2" />
                  </div>
                  <CardTitle className="text-lg">Database Studio</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Browse tables, view data, and execute SQL queries with a visual interface.
                </CardDescription>
              </CardContent>
            </Card>
          </Link>

          {/* Health Status Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="size-5 text-primary" icon="lucide:activity" />
                </div>
                <CardTitle className="text-lg">Health Status</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
                  Checking...
                </div>
              ) : health?.error ? (
                <Badge variant="destructive">{health.error}</Badge>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={health?.status === "healthy" ? "default" : "destructive"}>
                      {health?.status}
                    </Badge>
                    {health?.default && (
                      <span className="text-sm text-muted-foreground">
                        Default: {health.default}
                      </span>
                    )}
                  </div>
                  {health?.adapters && (
                    <div className="space-y-1">
                      {Object.entries(health.adapters).map(([type, status]) => (
                        <div key={type} className="flex items-center justify-between text-sm">
                          <span className="font-mono">{type}</span>
                          <Badge variant={status === "healthy" ? "outline" : "destructive"}>
                            {status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Adapters Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="size-5 text-primary" icon="lucide:database" />
                </div>
                <CardTitle className="text-lg">Adapters</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
                  Loading...
                </div>
              ) : health?.types ? (
                <div className="flex flex-wrap gap-2">
                  {health.types.map((type) => (
                    <Badge key={type} variant={type === health.default ? "default" : "outline"}>
                      {type}
                      {type === health.default && " (default)"}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No adapters configured</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
