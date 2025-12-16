import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

interface FormHeaderProps {
  actions?: ReactNode;
  className?: string;
  description?: ReactNode;
  title: ReactNode;
}

export function FormHeader({ title, description, actions, className }: FormHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between", className)}>
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-base font-medium leading-none">{title}</div>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      {actions && <div>{actions}</div>}
    </div>
  );
}
