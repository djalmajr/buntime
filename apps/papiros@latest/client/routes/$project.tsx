import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Icon,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  Skeleton,
} from "@buntime/shadcn-ui";
import { createFileRoute, Link, Outlet, useLocation, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProjectSwitcher } from "~/components/project-switcher";
import { useProject, useProjects, useProjectTree } from "~/hooks/use-projects";
import type { TreeItem } from "~/types";

export const Route = createFileRoute("/$project")({
  component: ProjectLayout,
});

interface BreadcrumbInfo {
  href?: string;
  label: string;
}

interface SidebarTreeProps {
  currentPath: string;
  items: TreeItem[];
  project: string;
}

/**
 * Recursive component to render hierarchical sidebar tree
 * Uses slug for URLs and active state detection
 */
function SidebarTree({ currentPath, items, project }: SidebarTreeProps) {
  return (
    <>
      {items.map((item) => {
        const isActive = currentPath === `/${project}/${item.slug}`;
        const hasActiveChild = item.children?.some(
          (child) =>
            currentPath === `/${project}/${child.slug}` ||
            child.children?.some((c) => currentPath === `/${project}/${c.slug}`),
        );

        if (item.type === "directory" && item.children) {
          return (
            <Collapsible
              asChild
              className="group/collapsible"
              defaultOpen={hasActiveChild}
              key={item.slug}
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton hasActiveChild={hasActiveChild}>
                    <Icon className="size-4" icon="lucide:folder-open" />
                    <span>{item.name}</span>
                    <Icon
                      className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90"
                      icon="lucide:chevron-right"
                    />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.children.map((child) => {
                      const childIsActive = currentPath === `/${project}/${child.slug}`;

                      if (child.type === "directory" && child.children) {
                        // Nested directory - recursive
                        const childHasActiveChild = child.children.some(
                          (c) => currentPath === `/${project}/${c.slug}`,
                        );

                        return (
                          <Collapsible
                            asChild
                            className="group/nested"
                            defaultOpen={childHasActiveChild}
                            key={child.slug}
                          >
                            <SidebarMenuSubItem>
                              <CollapsibleTrigger asChild>
                                <SidebarMenuSubButton
                                  className={childHasActiveChild ? "font-semibold" : ""}
                                >
                                  <span>{child.name}</span>
                                  <Icon
                                    className="ml-auto size-3 transition-transform duration-200 group-data-[state=open]/nested:rotate-90"
                                    icon="lucide:chevron-right"
                                  />
                                </SidebarMenuSubButton>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <SidebarMenuSub>
                                  {child.children.map((subChild) => (
                                    <SidebarMenuSubItem key={subChild.slug}>
                                      <SidebarMenuSubButton
                                        asChild
                                        isActive={currentPath === `/${project}/${subChild.slug}`}
                                      >
                                        <Link
                                          params={{ project, _splat: subChild.slug }}
                                          to="/$project/$"
                                        >
                                          {subChild.name}
                                        </Link>
                                      </SidebarMenuSubButton>
                                    </SidebarMenuSubItem>
                                  ))}
                                </SidebarMenuSub>
                              </CollapsibleContent>
                            </SidebarMenuSubItem>
                          </Collapsible>
                        );
                      }

                      return (
                        <SidebarMenuSubItem key={child.slug}>
                          <SidebarMenuSubButton asChild isActive={childIsActive}>
                            <Link params={{ project, _splat: child.slug }} to="/$project/$">
                              {child.name}
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      );
                    })}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          );
        }

        // File at root level
        return (
          <SidebarMenuItem key={item.slug}>
            <SidebarMenuButton asChild isActive={isActive}>
              <Link params={{ project, _splat: item.slug }} to="/$project/$">
                <Icon className="size-4" icon="lucide:file-text" />
                <span className="truncate">{item.name}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </>
  );
}

function ProjectLayout() {
  const { i18n, t } = useTranslation();
  const { project } = useParams({ from: "/$project" });
  const location = useLocation();

  const projects$ = useProjects();
  const project$ = useProject(project);
  const tree$ = useProjectTree(project, i18n.language);

  const pathname = decodeURIComponent(location.pathname);
  const isOverviewActive = pathname === `/${project}`;
  const tree = tree$.data?.tree ?? [];

  // Build breadcrumbs based on current route (using slugs)
  const buildBreadcrumbs = (): BreadcrumbInfo[] => {
    const crumbs: BreadcrumbInfo[] = [
      { href: `/${project}`, label: project$.data?.title || project },
    ];

    if (!isOverviewActive) {
      // Parse slug path for breadcrumbs
      const pathSegments = pathname.split("/").filter(Boolean);
      if (pathSegments.length > 1) {
        const slugPath = pathSegments.slice(1).join("/");
        const parts = slugPath.split("/");

        // Find items by matching slug segments
        let currentItems = tree;
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          const isLast = i === parts.length - 1;

          // Find item where slug ends with this part
          const item = currentItems.find((node) => {
            const nodeSlugPart = node.slug.split("/").pop();
            return nodeSlugPart === part;
          });

          if (item) {
            crumbs.push({ label: item.name });
            currentItems = item.children || [];
          } else if (isLast) {
            // Fallback for last segment if not found
            crumbs.push({ label: part ?? "" });
          }
        }
      }
    }

    return crumbs;
  };

  const breadcrumbs = buildBreadcrumbs();

  return (
    <SidebarProvider className="flex-1 flex-col relative min-h-0">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar>
          <SidebarHeader className="border-b h-14 p-1">
            <ProjectSwitcher currentProject={project$.data} projects={projects$.data ?? []} />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>{t("documentation")}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {/* Overview */}
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={isOverviewActive}>
                      <Link params={{ project }} to="/$project">
                        <Icon className="size-4" icon="lucide:book-open" />
                        <span>{t("introduction")}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {/* Loading state */}
                  {tree$.isPending && (
                    <>
                      {[1, 2, 3].map((i) => (
                        <SidebarMenuItem key={i}>
                          <SidebarMenuButton disabled>
                            <Skeleton className="h-4 w-4 rounded" />
                            <Skeleton className="h-4 flex-1" />
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </>
                  )}
                  {/* Tree */}
                  {!tree$.isPending && (
                    <SidebarTree currentPath={pathname} items={tree} project={project} />
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <SidebarInset className="flex flex-col overflow-hidden">
          {/* Header with SidebarTrigger and Breadcrumbs */}
          <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
            <SidebarTrigger className="-ml-1" />
            <Breadcrumb>
              <BreadcrumbList>
                {breadcrumbs.map((crumb, index) => {
                  const isLast = index === breadcrumbs.length - 1;

                  return (
                    <span className="contents" key={crumb.href ?? crumb.label}>
                      <BreadcrumbItem>
                        {isLast ? (
                          <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                        ) : crumb.href ? (
                          <BreadcrumbLink asChild>
                            <Link to={crumb.href}>{crumb.label}</Link>
                          </BreadcrumbLink>
                        ) : (
                          <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                        )}
                      </BreadcrumbItem>
                      {!isLast && <BreadcrumbSeparator />}
                    </span>
                  );
                })}
              </BreadcrumbList>
            </Breadcrumb>
          </header>
          <div className="flex-1 overflow-auto p-6" id="doc-scroll-container">
            <Outlet />
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
