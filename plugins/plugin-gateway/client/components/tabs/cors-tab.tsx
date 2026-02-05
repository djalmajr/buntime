import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

interface CorsConfig {
  enabled: boolean;
  origin: string | string[];
  credentials: boolean;
  methods: string[];
}

interface CorsTabProps {
  config: CorsConfig | null;
}

export function CorsTab({ config }: CorsTabProps) {
  if (!config?.enabled) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">CORS is not enabled</p>
          <p className="text-sm text-muted-foreground mt-2">
            Configure CORS in your gateway plugin settings
          </p>
        </CardContent>
      </Card>
    );
  }

  const origins = Array.isArray(config.origin) ? config.origin : [config.origin];

  return (
    <div className="space-y-4">
      {/* Configuration Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">CORS Configuration</CardTitle>
          <CardDescription>Cross-Origin Resource Sharing settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Credentials */}
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <p className="font-medium">Credentials</p>
              <p className="text-sm text-muted-foreground">
                Allow cookies and authorization headers
              </p>
            </div>
            <Badge variant={config.credentials ? "success" : "secondary"}>
              {config.credentials ? "Enabled" : "Disabled"}
            </Badge>
          </div>

          {/* Methods */}
          <div className="p-3 border rounded-lg">
            <p className="font-medium mb-2">Allowed Methods</p>
            <div className="flex flex-wrap gap-2">
              {config.methods.length > 0 ? (
                config.methods.map((method) => (
                  <Badge key={method} variant="outline">
                    {method}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">All methods allowed</span>
              )}
            </div>
          </div>

          {/* Origins */}
          <div className="p-3 border rounded-lg">
            <p className="font-medium mb-2">Allowed Origins</p>
            {origins.length === 1 && origins[0] === "*" ? (
              <div className="flex items-center gap-2">
                <Badge variant="warning">*</Badge>
                <span className="text-sm text-muted-foreground">All origins allowed</span>
              </div>
            ) : (
              <div className="space-y-1">
                {origins.map((origin) => (
                  <div key={origin} className="flex items-center gap-2">
                    <Badge variant="outline">{origin}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How CORS Works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            CORS (Cross-Origin Resource Sharing) is a security feature that controls how web pages
            from one origin can access resources from another origin.
          </p>
          <p>
            <strong>Preflight Requests:</strong> For "non-simple" requests (like those with custom
            headers or methods other than GET/POST), browsers send an OPTIONS request first to check
            if the actual request is allowed.
          </p>
          <p>
            <strong>Headers Added:</strong> The gateway adds Access-Control-Allow-Origin,
            Access-Control-Allow-Methods, Access-Control-Allow-Headers, and optionally
            Access-Control-Allow-Credentials headers to responses.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
