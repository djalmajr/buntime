import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, Link, Outlet, useMatches } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { NavMain } from "~/components/navigation/nav-main";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { Button } from "~/components/ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "~/components/ui/sidebar";
import { Toaster } from "~/components/ui/sonner";
import { HeaderProvider, useHeader } from "~/contexts/header-context";
import { queryClient } from "~/helpers/query-client";

type BreadcrumbLabel = string | [string, Record<string, unknown>?];

interface BreadcrumbEntry {
  label: BreadcrumbLabel;
  path: string;
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function DynamicBreadcrumbs() {
  const matches = useMatches();

  // Filter matches that have breadcrumb data and build breadcrumb trail
  const breadcrumbs = useMemo(() => {
    const result: Array<{ isLast: boolean; label: BreadcrumbLabel; path: string }> = [];

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      if (!match) continue;

      const isLastMatch = i === matches.length - 1;
      const loaderData = match.loaderData as
        | { breadcrumb?: BreadcrumbLabel; breadcrumbs?: BreadcrumbEntry[] }
        | undefined;

      // Support array of breadcrumbs (for dynamic paths like deployments)
      if (loaderData?.breadcrumbs) {
        loaderData.breadcrumbs.forEach((entry, idx) => {
          result.push({
            isLast: isLastMatch && idx === loaderData.breadcrumbs!.length - 1,
            label: entry.label,
            path: entry.path,
          });
        });
      }
      // Support single breadcrumb
      else if (loaderData?.breadcrumb) {
        result.push({
          isLast: isLastMatch,
          label: loaderData.breadcrumb,
          path: match.pathname,
        });
      }
    }

    return result;
  }, [matches]);

  // Extract namespaces from labels
  const namespaces = useMemo(() => {
    return uniq(
      breadcrumbs
        .map((bc) => {
          const key = Array.isArray(bc.label) ? bc.label[0] : bc.label;
          if (typeof key === "string" && key.includes(":")) {
            return key.split(":")[0];
          }
          return null;
        })
        .filter((n): n is string => n !== null && n !== "common"),
    );
  }, [breadcrumbs]);

  // Use translation with dynamic namespaces
  const { t } = useTranslation(namespaces.length > 0 ? namespaces : undefined);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {breadcrumbs.map((bc, idx) => {
          const key = Array.isArray(bc.label) ? bc.label[0] : bc.label;
          // Translate if it contains ":", otherwise use as-is (for dynamic labels like folder names)
          const label = key.includes(":")
            ? Array.isArray(bc.label)
              ? t(...bc.label)
              : t(bc.label)
            : key;

          return (
            <span className="contents" key={`${bc.path}-${idx}`}>
              <BreadcrumbItem>
                {bc.isLast ? (
                  <BreadcrumbPage>{label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={bc.path}>{label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!bc.isLast && <BreadcrumbSeparator />}
            </span>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function HeaderContent() {
  const { action } = useHeader();

  return (
    <header className="flex h-16 shrink-0 items-center gap-2">
      <div className="flex flex-1 items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <DynamicBreadcrumbs />
      </div>
      {action && (
        <div className="px-4">
          <Button asChild={!!action.href} size="sm" onClick={action.onClick}>
            {action.href ? (
              <Link to={action.href}>
                <Icon className="size-4" icon="lucide:plus" />
                <span>{action.label}</span>
              </Link>
            ) : (
              <>
                <Icon className="size-4" icon="lucide:plus" />
                <span>{action.label}</span>
              </>
            )}
          </Button>
        </div>
      )}
    </header>
  );
}

export const Route = createRootRoute({
  beforeLoad: () => ({ queryClient }),
  component: () => (
    <QueryClientProvider client={queryClient}>
      <HeaderProvider>
        <SidebarProvider>
          <NavMain />
          <SidebarInset>
            <HeaderContent />
            <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
              <Outlet />
            </div>
          </SidebarInset>
        </SidebarProvider>
        <Toaster />
      </HeaderProvider>
    </QueryClientProvider>
  ),
});
