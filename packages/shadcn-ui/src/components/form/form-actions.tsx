import { Button } from "../ui/button";
import { Icon } from "../ui/icon";

interface FormActionsProps {
  cancelLabel?: string;
  creatingLabel?: string;
  isEditMode?: boolean;
  isSubmitting: boolean;
  isValid: boolean;
  savingLabel?: string;
  submitLabel: string;
  onCancel: () => void;
}

export function FormActions({
  cancelLabel = "Cancel",
  creatingLabel = "Creating...",
  isEditMode = false,
  isSubmitting,
  isValid,
  savingLabel = "Saving...",
  submitLabel,
  onCancel,
}: FormActionsProps) {
  return (
    <div className="flex gap-3">
      <Button type="submit" disabled={!isValid || isSubmitting} className="min-w-[120px]">
        {isSubmitting ? (
          <>
            <Icon className="mr-2 size-4 animate-spin" icon="lucide:loader" />
            {isEditMode ? savingLabel : creatingLabel}
          </>
        ) : (
          submitLabel
        )}
      </Button>
      <Button type="button" variant="outline" disabled={isSubmitting} onClick={onCancel}>
        {cancelLabel}
      </Button>
    </div>
  );
}
