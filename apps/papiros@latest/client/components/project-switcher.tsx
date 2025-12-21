import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Icon,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@buntime/shadcn-ui";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { Project } from "~/types";

interface ProjectSwitcherProps {
  currentProject?: Project | null;
  projects: Project[];
}

const DEFAULT_ICON = "lucide:book-open";

export function ProjectSwitcher({ currentProject, projects }: ProjectSwitcherProps) {
  const { t } = useTranslation();
  const { isMobile } = useSidebar();

  const displayName = currentProject?.title || t("loading");

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              size="lg"
            >
              <div className="flex aspect-square size-7 items-center justify-center">
                <Icon className="text-2xl" icon={currentProject?.icon || DEFAULT_ICON} />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{displayName}</span>
              </div>
              <Icon className="ml-auto size-4" icon="lucide:chevrons-up-down" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              {t("projects")}
            </DropdownMenuLabel>
            {projects.map((project) => {
              const isSelected = currentProject?.name === project.name;
              return (
                <DropdownMenuItem asChild className="gap-2 p-2 cursor-pointer" key={project.name}>
                  <Link params={{ project: project.name }} to="/$project">
                    <div className="flex size-6 items-center justify-center rounded-md border">
                      <Icon className="text-sm shrink-0" icon={project.icon || DEFAULT_ICON} />
                    </div>
                    <div className="flex flex-1 flex-col">
                      <span className={isSelected ? "font-semibold" : ""}>{project.title}</span>
                    </div>
                    {isSelected && <Icon className="ml-auto size-4" icon="lucide:check" />}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
