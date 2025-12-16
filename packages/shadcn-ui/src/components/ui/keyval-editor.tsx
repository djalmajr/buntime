import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Button } from "./button";
import { Icon } from "./icon";
import { Input } from "./input";
import { Label } from "./label";
import { Switch } from "./switch";

export interface KeyValEditorRef {
  addEntry: () => void;
}

interface KeyValEditorLabels {
  addButton: string;
  emptyState: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
}

interface KeyValEntry {
  id: number;
  key: string;
  value: string;
}

interface KeyValEditorProps {
  className?: string;
  defaultValue?: Record<string, string>;
  hideAddButton?: boolean;
  labels: KeyValEditorLabels;
  onChange: (value: Record<string, string>) => void;
  onAdd?: () => void;
}

let nextId = 0;

function recordToEntries(record: Record<string, string>): KeyValEntry[] {
  const entries = Object.entries(record);
  if (entries.length === 0) return [];
  return entries.map(([key, value]) => ({
    id: nextId++,
    key,
    value,
  }));
}

function entriesToRecord(entries: KeyValEntry[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of entries) {
    result[entry.key] = entry.value;
  }
  return result;
}

/**
 * Simple key-value pair editor (uncontrolled)
 */
export const KeyValEditor = forwardRef<KeyValEditorRef, KeyValEditorProps>(function KeyValEditor(
  { className, defaultValue = {}, hideAddButton, labels, onChange, onAdd },
  ref,
) {
  const [entries, setEntries] = useState<KeyValEntry[]>(() => recordToEntries(defaultValue));
  const entriesRef = useRef(entries);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const notifyChange = (updated: KeyValEntry[]) => {
    onChangeRef.current(entriesToRecord(updated));
  };

  const handleKeyChange = (id: number, newKey: string) => {
    setEntries((prev) => {
      const updated = prev.map((e) => (e.id === id ? { ...e, key: newKey } : e));
      entriesRef.current = updated;
      return updated;
    });
  };

  const handleValueChange = (id: number, newValue: string) => {
    setEntries((prev) => {
      const updated = prev.map((e) => (e.id === id ? { ...e, value: newValue } : e));
      entriesRef.current = updated;
      return updated;
    });
  };

  const handleBlur = (e: React.FocusEvent) => {
    // Only notify if focus is leaving the editor entirely (not moving between inputs)
    const container = e.currentTarget.closest("[data-keyval-editor]");
    if (container && !container.contains(e.relatedTarget as Node)) {
      notifyChange(entriesRef.current);
    }
  };

  const handleRemove = (id: number) => {
    setEntries((prev) => {
      const updated = prev.filter((e) => e.id !== id);
      entriesRef.current = updated;
      return updated;
    });
    // Defer onChange to avoid double render
    setTimeout(() => notifyChange(entriesRef.current), 0);
  };

  const handleAdd = () => {
    setEntries((prev) => {
      const updated = [...prev, { id: nextId++, key: "", value: "" }];
      entriesRef.current = updated;
      return updated;
    });
    onAdd?.();
  };

  useImperativeHandle(ref, () => ({
    addEntry: handleAdd,
  }));

  return (
    <div className={className} data-keyval-editor>
      <div className="space-y-2">
        {entries.length > 0 ? (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div key={entry.id} className="flex gap-2">
                <Input
                  className="flex-1"
                  placeholder={labels.keyPlaceholder}
                  value={entry.key}
                  onBlur={handleBlur}
                  onChange={(e) => handleKeyChange(entry.id, e.target.value)}
                />
                <Input
                  className="flex-1"
                  placeholder={labels.valuePlaceholder}
                  value={entry.value}
                  onBlur={handleBlur}
                  onChange={(e) => handleValueChange(entry.id, e.target.value)}
                />
                <Button
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={() => handleRemove(entry.id)}
                >
                  <Icon className="size-4" icon="lucide:x" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-4 text-center text-muted-foreground text-sm">
            {labels.emptyState}
          </div>
        )}
        {!hideAddButton && (
          <Button className="w-full" size="sm" type="button" variant="outline" onClick={handleAdd}>
            <Icon className="mr-1 size-4" icon="lucide:plus" />
            {labels.addButton}
          </Button>
        )}
      </div>
    </div>
  );
});

interface KeyValSwitchableEditorProps extends KeyValEditorProps {
  checked: boolean;
  description: string;
  id: string;
  title: string;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * Key-value editor with switchable section wrapper
 */
export function KeyValSwitchableEditor({
  checked,
  className,
  defaultValue,
  description,
  id,
  labels,
  title,
  onChange,
  onCheckedChange,
}: KeyValSwitchableEditorProps) {
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
      {checked && (
        <KeyValEditor
          className={className}
          defaultValue={defaultValue}
          labels={labels}
          onChange={onChange}
        />
      )}
    </div>
  );
}
