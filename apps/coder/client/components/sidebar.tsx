import { useState } from "react";
import { Icon } from "~/components/icon";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/libs/cn";

interface EditorSidebarProps {
  children: React.ReactNode;
  className?: string;
  title: string;
}

/**
 * Editor-specific sidebar panel (used within project editor)
 * Uses same visual pattern as the global sidebar
 */
export function Sidebar({ children, className, title }: EditorSidebarProps) {
  return (
    <div className={cn("bg-sidebar flex h-full w-full flex-col", className)}>
      <div className="text-sidebar-foreground/70 flex h-9 items-center px-4 text-xs font-semibold uppercase tracking-wider">
        {title}
      </div>
      <ScrollArea className="flex-1">{children}</ScrollArea>
    </div>
  );
}

interface SidebarSectionProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
  title: string;
}

export function SidebarSection({ children, defaultOpen = true, title }: SidebarSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="bg-sidebar-accent/50 text-sidebar-foreground flex w-full items-center gap-1 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider">
        <Icon
          className={cn("size-4 transition-transform", !isOpen && "-rotate-90")}
          name="lucide:chevron-down"
        />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
