import { useState } from "react";
import { Icon } from "~/components/icon";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "~/components/ui/sidebar";

const navItems = [
  { icon: "lucide:bell", name: "Notifications" },
  { icon: "lucide:paintbrush", name: "Appearance" },
  { icon: "lucide:globe", name: "Language & region" },
  { icon: "lucide:keyboard", name: "Accessibility" },
  { icon: "lucide:link", name: "Connected accounts" },
  { icon: "lucide:lock", name: "Privacy & visibility" },
  { icon: "lucide:settings", name: "Advanced" },
];

type NavItemName = (typeof navItems)[number]["name"];

interface SettingsDialogProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function SettingsDialog({ onOpenChange, open }: SettingsDialogProps) {
  const [activeItem, setActiveItem] = useState<NavItemName>(navItems[0]!.name);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="overflow-hidden p-0 md:max-h-[500px] md:max-w-[700px] lg:max-w-[800px]"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">Customize your settings here.</DialogDescription>
        <SidebarProvider className="items-start">
          <Sidebar className="hidden md:flex" collapsible="none">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {navItems.map((item) => (
                      <SidebarMenuItem key={item.name}>
                        <SidebarMenuButton
                          isActive={item.name === activeItem}
                          onClick={() => setActiveItem(item.name)}
                        >
                          <Icon icon={item.icon} />
                          <span>{item.name}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex h-[480px] flex-1 flex-col overflow-hidden">
            <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
              <div className="flex items-center gap-2 px-4">
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbLink href="#">Settings</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{activeItem}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </header>
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 pt-0">
              <div className="text-muted-foreground flex h-full items-center justify-center">
                <p>Settings content for "{activeItem}" will appear here.</p>
              </div>
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
