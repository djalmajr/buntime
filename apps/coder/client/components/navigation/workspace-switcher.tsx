import { Icon } from "~/components/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "~/components/ui/sidebar";

export function WorkspaceSwitcher() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton className="data-[state=open]:bg-sidebar-accent" size="lg">
              <div className="bg-primary flex size-8 items-center justify-center rounded">
                <Icon className="text-primary-foreground size-5" name="lucide:code" />
              </div>
              <div className="flex flex-1 flex-col text-left text-sm leading-tight">
                <span className="truncate font-semibold">Buntime IDE</span>
                <span className="text-muted-foreground truncate text-xs">Personal</span>
              </div>
              <Icon className="size-4" name="lucide:chevrons-up-down" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-[--radix-dropdown-menu-trigger-width]"
            side="bottom"
          >
            <DropdownMenuItem>
              <Icon className="size-4" name="lucide:user" />
              Personal Workspace
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Icon className="size-4" name="lucide:plus" />
              Create Workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
