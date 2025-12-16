import type { ReactNode } from "react";
import { Label } from "./label";
import { Switch } from "./switch";

interface SwitchableSectionProps {
  checked: boolean;
  children?: ReactNode;
  description: string;
  id: string;
  title: string;
  onCheckedChange: (checked: boolean) => void;
}

export function SwitchableSection({
  checked,
  children,
  description,
  id,
  title,
  onCheckedChange,
}: SwitchableSectionProps) {
  return (
    <div className="space-y-4 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="space-y-1">
          <Label className="text-sm font-medium" htmlFor={id}>
            {title}
          </Label>
          <p className="text-muted-foreground text-xs">{description}</p>
        </div>
        <Switch checked={checked} id={id} onCheckedChange={onCheckedChange} />
      </div>
      {checked && children}
    </div>
  );
}
