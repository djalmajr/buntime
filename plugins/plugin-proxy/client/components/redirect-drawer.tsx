import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "./ui/drawer";
import { Icon } from "./ui/icon";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

export interface RedirectData {
  base?: string;
  changeOrigin?: boolean;
  headers?: Record<string, string>;
  id?: string;
  name?: string;
  pattern: string;
  relativePaths?: boolean;
  rewrite?: string;
  secure?: boolean;
  target: string;
  ws?: boolean;
}

interface RedirectDrawerProps {
  onOpenChange: (open: boolean) => void;
  onSave: (redirect: RedirectData) => void;
  open: boolean;
  readonly?: boolean;
  redirect: RedirectData | null;
}

const initFormData: RedirectData = {
  base: "",
  changeOrigin: true,
  headers: {},
  name: "",
  pattern: "",
  relativePaths: false,
  rewrite: "",
  secure: true,
  target: "",
  ws: true,
};

export function RedirectDrawer({
  onOpenChange,
  onSave,
  open,
  readonly,
  redirect,
}: RedirectDrawerProps) {
  const [formData, setFormData] = useState<RedirectData>(structuredClone(initFormData));
  const [hasHeaders, setHasHeaders] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const isEditMode = !!redirect;
  const isViewMode = !!readonly;
  const headers = formData.headers || {};
  const headersEntries = Object.entries(headers);

  const isNameEmpty = !formData.name?.trim();
  const isPatternEmpty = !formData.pattern.trim();
  const isTargetEmpty = !formData.target.trim();

  const showNameError = isDirty && isNameEmpty;
  const showPatternError = isDirty && isPatternEmpty;
  const showTargetError = isDirty && isTargetEmpty;

  const isFormInvalid = isNameEmpty || isPatternEmpty || isTargetEmpty;

  const setField = <K extends keyof RedirectData>(field: K, value: RedirectData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const addHeader = () => {
    setField("headers", { ...headers, "": "" });
  };

  const updateHeaderKey = (oldKey: string, newKey: string, value: string) => {
    const newHeaders = { ...headers };
    delete newHeaders[oldKey];
    newHeaders[newKey] = value;
    setField("headers", newHeaders);
  };

  const updateHeaderValue = (key: string, value: string) => {
    setField("headers", { ...headers, [key]: value });
  };

  const removeHeader = (key: string) => {
    const newHeaders = { ...headers };
    delete newHeaders[key];
    setField("headers", newHeaders);
  };

  const handleSave = () => {
    setIsDirty(true);
    if (isFormInvalid) return;

    const cleanHeaders = Object.fromEntries(
      Object.entries(headers).filter(([k, v]) => k.trim() && v.trim()),
    );

    onSave({
      ...formData,
      base: formData.base?.trim() || undefined,
      headers: Object.keys(cleanHeaders).length > 0 ? cleanHeaders : undefined,
      rewrite: formData.rewrite?.trim() || undefined,
    });
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      if (redirect) {
        setFormData(structuredClone(redirect));
        setHasHeaders(Object.keys(redirect.headers || {}).length > 0);
      } else {
        setFormData(structuredClone(initFormData));
        setHasHeaders(false);
      }
      setIsDirty(false);
    }
  }, [open, redirect]);

  return (
    <Drawer direction="right" onOpenChange={onOpenChange} open={open}>
      <DrawerContent className="h-full w-[640px]">
        <DrawerHeader>
          <DrawerTitle>
            {isViewMode ? "View Redirect" : isEditMode ? "Edit Redirect" : "New Redirect"}
          </DrawerTitle>
          <DrawerDescription>
            {isViewMode
              ? "View the redirect configuration (read-only)."
              : isEditMode
                ? "Update the redirect settings below."
                : "Configure the redirect settings below."}
          </DrawerDescription>
        </DrawerHeader>
        <div className="space-y-6 overflow-y-auto px-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              disabled={isViewMode}
              id="name"
              placeholder="my-api-proxy"
              required
              value={formData.name}
              onChange={(evt) => setField("name", evt.target.value)}
            />
            {showNameError && <p className="text-sm text-destructive">This field is required</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="pattern">Pattern</Label>
            <Input
              disabled={isViewMode}
              id="pattern"
              placeholder="^/api/(.*)$"
              required
              value={formData.pattern}
              onChange={(evt) => setField("pattern", evt.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              JavaScript regular expression to match paths
            </p>
            {showPatternError && <p className="text-sm text-destructive">This field is required</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="target">Target URL</Label>
            <Input
              disabled={isViewMode}
              id="target"
              placeholder="http://backend:8080"
              required
              value={formData.target}
              onChange={(evt) => setField("target", evt.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              Target URL (supports $&#123;ENV_VAR&#125; syntax)
            </p>
            {showTargetError && <p className="text-sm text-destructive">This field is required</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="rewrite">Rewrite</Label>
            <Input
              disabled={isViewMode}
              id="rewrite"
              placeholder="/v1/$1"
              value={formData.rewrite ?? ""}
              onChange={(evt) => setField("rewrite", evt.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              Path rewrite using regex capture groups ($1, $2, etc.)
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="base">Base Path</Label>
            <Input
              disabled={isViewMode}
              id="base"
              placeholder="/my-app"
              value={formData.base ?? ""}
              onChange={(evt) => setField("base", evt.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              Inject &lt;base href&gt; tag into HTML responses (for SPAs under subpaths)
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="relativePaths">Relative Paths</Label>
              <p className="text-sm text-muted-foreground">
                Rewrite absolute paths (/...) to relative (./) in HTML responses
              </p>
            </div>
            <Switch
              checked={formData.relativePaths ?? false}
              disabled={isViewMode}
              id="relativePaths"
              onCheckedChange={(checked: boolean) => setField("relativePaths", checked)}
            />
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="hasHeaders">Custom Headers</Label>
                <p className="text-sm text-muted-foreground">
                  Additional headers to send with requests
                </p>
              </div>
              <Switch
                checked={hasHeaders}
                disabled={isViewMode}
                id="hasHeaders"
                onCheckedChange={(checked: boolean) => {
                  setHasHeaders(checked);
                  if (!checked) setField("headers", {});
                }}
              />
            </div>
            {hasHeaders && (
              <div className="space-y-2">
                {headersEntries.length > 0 ? (
                  <div className="space-y-2">
                    {headersEntries.map(([key, value], idx) => (
                      <div className="flex gap-2" key={idx}>
                        <Input
                          className="flex-1"
                          disabled={isViewMode}
                          placeholder="Header name"
                          value={key}
                          onChange={(evt) => updateHeaderKey(key, evt.target.value, value)}
                        />
                        <Input
                          className="flex-1"
                          disabled={isViewMode}
                          placeholder="Header value"
                          value={value}
                          onChange={(evt) => updateHeaderValue(key, evt.target.value)}
                        />
                        {!isViewMode && (
                          <Button
                            size="icon"
                            type="button"
                            variant="ghost"
                            onClick={() => removeHeader(key)}
                          >
                            <Icon className="size-4" icon="lucide:x" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                    No headers configured. Click the button below to add one.
                  </div>
                )}
                {!isViewMode && (
                  <Button
                    className="w-full"
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={addHeader}
                  >
                    <Icon className="mr-1 size-4" icon="lucide:plus" />
                    Add Header
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="changeOrigin">Change Origin</Label>
              <p className="text-sm text-muted-foreground">Change Host/Origin headers to target</p>
            </div>
            <Switch
              checked={formData.changeOrigin ?? false}
              disabled={isViewMode}
              id="changeOrigin"
              onCheckedChange={(checked: boolean) => setField("changeOrigin", checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="secure">Verify SSL</Label>
              <p className="text-sm text-muted-foreground">
                Verify SSL certificates (recommended for production)
              </p>
            </div>
            <Switch
              checked={formData.secure ?? false}
              disabled={isViewMode}
              id="secure"
              onCheckedChange={(checked: boolean) => setField("secure", checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="ws">WebSocket Proxy</Label>
              <p className="text-sm text-muted-foreground">
                Proxy WebSocket connections (disable for Vite/HMR issues)
              </p>
            </div>
            <Switch
              checked={formData.ws ?? true}
              disabled={isViewMode}
              id="ws"
              onCheckedChange={(checked: boolean) => setField("ws", checked)}
            />
          </div>
        </div>
        <DrawerFooter>
          <div className="flex items-center justify-end gap-2">
            <DrawerClose asChild>
              <Button variant="outline">{isViewMode ? "Close" : "Cancel"}</Button>
            </DrawerClose>
            {!isViewMode && (
              <Button onClick={handleSave}>{isEditMode ? "Save" : "Create Redirect"}</Button>
            )}
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
