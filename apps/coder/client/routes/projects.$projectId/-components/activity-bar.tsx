import { Icon } from "~/components/icon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/helpers/cn";

export type ActivityView = "dependencies" | "explorer" | "search";

interface ActivityBarProps {
  activeView: ActivityView;
  onViewChange: (view: ActivityView) => void;
}

interface ActivityButtonProps {
  active?: boolean;
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
}

function ActivityButton({ active, icon, title, onClick }: ActivityButtonProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={cn(
              "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex size-10 items-center justify-center rounded-md transition-colors",
              active && "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
            type="button"
            onClick={onClick}
          >
            {icon}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={4}>
          {title}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ActivityBar({ activeView, onViewChange }: ActivityBarProps) {
  return (
    <div className="bg-sidebar border-sidebar-border flex h-full w-12 flex-col items-center gap-1 border-r py-2">
      <div className="flex flex-col gap-1">
        <ActivityButton
          active={activeView === "explorer"}
          icon={<Icon className="size-5" name="lucide:files" />}
          title="Explorer"
          onClick={() => onViewChange("explorer")}
        />
        <ActivityButton
          active={activeView === "search"}
          icon={<Icon className="size-5" name="lucide:search" />}
          title="Search"
          onClick={() => onViewChange("search")}
        />
        <ActivityButton
          active={activeView === "dependencies"}
          icon={<Icon className="size-5" name="lucide:package" />}
          title="Dependencies"
          onClick={() => onViewChange("dependencies")}
        />
      </div>
    </div>
  );
}
