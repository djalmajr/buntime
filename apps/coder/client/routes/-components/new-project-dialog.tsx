import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { cn } from "~/helpers/cn";
import { type TemplateId, templateList } from "~/helpers/templates";
import { TemplateIcon } from "./template-icon";

interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, template: TemplateId) => void;
}

export function NewProjectDialog({ open, onClose, onCreate }: NewProjectDialogProps) {
  const [name, setName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>("react");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setSelectedTemplate("react");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const handleSubmit = useCallback(
    (evt: React.FormEvent) => {
      evt.preventDefault();
      if (name.trim()) {
        onCreate(name.trim(), selectedTemplate);
        onClose();
      }
    },
    [name, onClose, onCreate, selectedTemplate],
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-zinc-900 text-zinc-100 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Choose a template and give your project a name
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="project-name">
                Project Name
              </label>
              <Input
                className="border-zinc-600 bg-zinc-800"
                id="project-name"
                placeholder="my-awesome-project"
                ref={inputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <fieldset>
              <legend className="mb-2 block text-sm font-medium">Template</legend>
              <div className="grid grid-cols-3 gap-3">
                {templateList.map((template) => (
                  <button
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors",
                      selectedTemplate === template.id
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-zinc-700 hover:border-zinc-500",
                    )}
                    key={template.id}
                    type="button"
                    onClick={() => setSelectedTemplate(template.id)}
                  >
                    <TemplateIcon className="size-8 text-zinc-300" template={template.id} />
                    <span className="text-sm font-medium">{template.name}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                {templateList.find((t) => t.id === selectedTemplate)?.description}
              </p>
            </fieldset>
          </div>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!name.trim()} type="submit">
              Create Project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
