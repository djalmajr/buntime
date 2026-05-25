import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import { Input } from "~/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import type { ApiPermission, PackageSource } from "~/helpers/admin-api";
import { RuntimeApiError } from "~/helpers/api-client";
import type { UploadValidationResult } from "~/helpers/upload-validation";
import { cn } from "~/utils/cn";

/* ────────────────────────────────────────────────────────────────────── */
/* Shared types                                                          */
/* ────────────────────────────────────────────────────────────────────── */

export interface CapabilityGroup {
  icon: string;
  label: string;
  permissions: ApiPermission[];
}

export interface OverviewMetric {
  help?: string;
  icon: string;
  label: string;
  value: string;
}

export interface AdminPluginRow {
  aliases: string[];
  base?: string;
  dependencies: string[];
  installed: boolean;
  loaded: boolean;
  name: string;
  path?: string;
  removable: boolean;
  removeName?: string;
  source?: PackageSource;
}

/* ────────────────────────────────────────────────────────────────────── */
/* Helpers                                                               */
/* ────────────────────────────────────────────────────────────────────── */

export function getErrorMessage(error: unknown): string {
  if (error instanceof RuntimeApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

export function formatTimestamp(value?: number): string {
  if (!value) return "-";
  return new Date(value * 1000).toLocaleString();
}

export function getPluginIdentity(name: string): string {
  if (name.startsWith("@buntime/plugin-")) {
    return name.replace("@buntime/", "").toLowerCase();
  }
  return name.toLowerCase();
}

/* ────────────────────────────────────────────────────────────────────── */
/* Atomic UI components                                                  */
/* ────────────────────────────────────────────────────────────────────── */

export function SourceBadge({ source }: { source: PackageSource }) {
  const { t } = useTranslation();
  const label =
    source === "built-in" ? t("admin.common.builtIn") : t("admin.common.uploadedSource");

  return (
    <span
      className={cn(
        "rounded px-2 py-0.5 text-xs",
        source === "built-in"
          ? "bg-secondary text-secondary-foreground"
          : "bg-primary/10 text-primary",
      )}
    >
      {label}
    </span>
  );
}

export function Section({
  actions,
  children,
  description,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className="border-border bg-background rounded-md border">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="border-border text-muted-foreground rounded-md border border-dashed px-4 py-8 text-center text-sm">
      {children}
    </div>
  );
}

export function AdminSearchToolbar({
  actions,
  placeholder,
  search,
  onSearchChange,
}: {
  actions?: ReactNode;
  placeholder: string;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative w-full max-w-lg">
        <Icon
          className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2"
          icon="lucide:search"
        />
        <Input
          className="pl-9"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={placeholder}
          type="search"
          value={search}
        />
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ResourceTable({ children }: { children: ReactNode }) {
  return <section className="border-border overflow-hidden rounded-lg border">{children}</section>;
}

export function UploadValidationPanel({
  validation,
  validating,
}: {
  validation: UploadValidationResult | null;
  validating: boolean;
}) {
  const { t } = useTranslation();

  if (validating) {
    return (
      <div className="border-border text-muted-foreground rounded-md border px-3 py-2 text-sm">
        {t("admin.uploadValidation.checking")}
      </div>
    );
  }

  if (!validation) return null;

  if (validation.errors.length === 0 && validation.warnings.length === 0) {
    return (
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
        {t("admin.uploadValidation.valid", { count: validation.entries.length })}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        validation.errors.length > 0
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700",
      )}
    >
      <ul className="grid gap-1">
        {validation.errors.map((issue) => (
          <li key={`error-${issue.code}`}>
            {t(`admin.uploadValidation.errors.${issue.code}`, issue.values)}
          </li>
        ))}
        {validation.warnings.map((issue) => (
          <li key={`warning-${issue.code}`}>
            {t(`admin.uploadValidation.warnings.${issue.code}`, issue.values)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function UploadArchiveSheet({
  file,
  open,
  title,
  uploadDisabled,
  validation,
  validating,
  onFileChange,
  onOpenChange,
  onSubmit,
}: {
  file: File | null;
  open: boolean;
  title: string;
  uploadDisabled: boolean;
  validation: UploadValidationResult | null;
  validating: boolean;
  onFileChange: (file: File | null) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{t("admin.common.uploadArchiveDescription")}</SheetDescription>
        </SheetHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="grid flex-1 gap-3 overflow-y-auto p-4">
            <Input
              accept=".zip,.tgz,.tar.gz,application/zip,application/gzip"
              aria-invalid={validation ? !validation.ok : undefined}
              key={file?.name ?? "empty-admin-upload"}
              onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
              type="file"
            />
            <UploadValidationPanel validation={validation} validating={validating} />
          </div>
          <SheetFooter className="border-t">
            <Button disabled={uploadDisabled} type="submit">
              <Icon className="size-4" icon="lucide:upload" />
              {t("admin.common.upload")}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
