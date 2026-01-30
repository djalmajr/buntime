import { Checkbox } from "~/components/ui/checkbox";
import type { CellVariantProps } from "../types";

export function CheckboxCell({ isEditable, value, onSave }: CellVariantProps) {
  const isChecked = value === 1 || value === true || value === "1" || value === "true";
  const isNull = value === null || value === undefined;

  const handleChange = (checked: boolean) => {
    if (isEditable) {
      onSave(checked ? "1" : "0");
    }
  };

  if (isNull) {
    return <span className="block px-2 py-1.5 text-sm text-muted-foreground italic">NULL</span>;
  }

  return (
    <div className="flex h-full items-center justify-center">
      <Checkbox checked={isChecked} disabled={!isEditable} onCheckedChange={handleChange} />
    </div>
  );
}
