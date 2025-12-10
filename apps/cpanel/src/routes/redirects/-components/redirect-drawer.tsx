import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { Button } from "~/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "~/components/ui/drawer";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";

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

export function RedirectDrawer({ onOpenChange, onSave, open, redirect }: RedirectDrawerProps) {
  const { t } = useTranslation("redirects");
  const [formData, setFormData] = useState<RedirectData>(structuredClone(initFormData));
  const [hasHeaders, setHasHeaders] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const isEditMode = !!redirect;
  const headers = formData.headers || {};
  const headersEntries = Object.entries(headers);

  // Validation
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

    // Filter out empty headers
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
          <DrawerTitle>{isEditMode ? t("drawer.editTitle") : t("drawer.title")}</DrawerTitle>
          <DrawerDescription>
            {isEditMode ? t("drawer.editDescription") : t("drawer.description")}
          </DrawerDescription>
        </DrawerHeader>
        <div className="space-y-6 overflow-y-auto px-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t("form.name")}</Label>
            <Input
              id="name"
              placeholder={t("form.namePlaceholder")}
              required
              value={formData.name}
              onChange={(evt) => setField("name", evt.target.value)}
            />
            {showNameError && (
              <p className="text-sm text-destructive">{t("common:validation.required")}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="pattern">{t("form.pattern")}</Label>
            <Input
              id="pattern"
              placeholder={t("form.patternPlaceholder")}
              required
              value={formData.pattern}
              onChange={(evt) => setField("pattern", evt.target.value)}
            />
            <p className="text-sm text-muted-foreground">{t("form.patternDescription")}</p>
            {showPatternError && (
              <p className="text-sm text-destructive">{t("common:validation.required")}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="target">{t("form.target")}</Label>
            <Input
              id="target"
              placeholder={t("form.targetPlaceholder")}
              required
              value={formData.target}
              onChange={(evt) => setField("target", evt.target.value)}
            />
            <p className="text-sm text-muted-foreground">{t("form.targetDescription")}</p>
            {showTargetError && (
              <p className="text-sm text-destructive">{t("common:validation.required")}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="rewrite">{t("form.rewrite")}</Label>
            <Input
              id="rewrite"
              placeholder={t("form.rewritePlaceholder")}
              value={formData.rewrite ?? ""}
              onChange={(evt) => setField("rewrite", evt.target.value)}
            />
            <p className="text-sm text-muted-foreground">{t("form.rewriteDescription")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="base">{t("form.base")}</Label>
            <Input
              id="base"
              placeholder={t("form.basePlaceholder")}
              value={formData.base ?? ""}
              onChange={(evt) => setField("base", evt.target.value)}
            />
            <p className="text-sm text-muted-foreground">{t("form.baseDescription")}</p>
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="relativePaths">{t("form.relativePaths")}</Label>
              <p className="text-sm text-muted-foreground">{t("form.relativePathsDescription")}</p>
            </div>
            <Switch
              checked={formData.relativePaths ?? false}
              id="relativePaths"
              onCheckedChange={(checked) => setField("relativePaths", checked)}
            />
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="hasHeaders">{t("form.headers")}</Label>
                <p className="text-sm text-muted-foreground">{t("form.headersDescription")}</p>
              </div>
              <Switch
                checked={hasHeaders}
                id="hasHeaders"
                onCheckedChange={(checked) => {
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
                          placeholder={t("form.headerName")}
                          value={key}
                          onChange={(evt) => updateHeaderKey(key, evt.target.value, value)}
                        />
                        <Input
                          className="flex-1"
                          placeholder={t("form.headerValue")}
                          value={value}
                          onChange={(evt) => updateHeaderValue(key, evt.target.value)}
                        />
                        <Button
                          size="icon"
                          type="button"
                          variant="ghost"
                          onClick={() => removeHeader(key)}
                        >
                          <Icon className="size-4" icon="lucide:x" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                    {t("form.emptyHeaders")}
                  </div>
                )}
                <Button
                  className="w-full"
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={addHeader}
                >
                  <Icon className="mr-1 size-4" icon="lucide:plus" />
                  {t("form.addHeader")}
                </Button>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="changeOrigin">{t("form.changeOrigin")}</Label>
              <p className="text-sm text-muted-foreground">{t("form.changeOriginDescription")}</p>
            </div>
            <Switch
              checked={formData.changeOrigin ?? false}
              id="changeOrigin"
              onCheckedChange={(checked) => setField("changeOrigin", checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="secure">{t("form.secure")}</Label>
              <p className="text-sm text-muted-foreground">{t("form.secureDescription")}</p>
            </div>
            <Switch
              checked={formData.secure ?? false}
              id="secure"
              onCheckedChange={(checked) => setField("secure", checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="ws">{t("form.ws")}</Label>
              <p className="text-sm text-muted-foreground">{t("form.wsDescription")}</p>
            </div>
            <Switch
              checked={formData.ws ?? true}
              id="ws"
              onCheckedChange={(checked) => setField("ws", checked)}
            />
          </div>
        </div>
        <DrawerFooter>
          <div className="flex items-center justify-end gap-2">
            <DrawerClose asChild>
              <Button variant="outline">{t("actions.cancel")}</Button>
            </DrawerClose>
            <Button onClick={handleSave}>
              {isEditMode ? t("actions.save") : t("actions.create")}
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
