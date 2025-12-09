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

interface CreateItemDialogProps {
  open: boolean;
  parentPath: string;
  type: "file" | "folder";
  onClose: () => void;
  onCreate: (name: string) => void;
}

export function CreateItemDialog({
  open,
  parentPath,
  type,
  onClose,
  onCreate,
}: CreateItemDialogProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const handleSubmit = useCallback(
    (evt: React.FormEvent) => {
      evt.preventDefault();
      if (name.trim()) {
        onCreate(name.trim());
        onClose();
      }
    },
    [name, onClose, onCreate],
  );

  const displayPath = parentPath === "/" ? "" : parentPath;
  const fullPath = `${displayPath}/${name || "..."}`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-zinc-900 text-zinc-100">
        <DialogHeader>
          <DialogTitle>{type === "file" ? "Create New File" : "Create New Folder"}</DialogTitle>
          <DialogDescription className="text-zinc-400">
            {type === "file"
              ? "Enter the name for your new file"
              : "Enter the name for your new folder"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <Input
              className="border-zinc-600 bg-zinc-800"
              placeholder={type === "file" ? "filename.tsx" : "folder-name"}
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-sm text-zinc-500">
              Path: <code className="text-zinc-400">{fullPath}</code>
            </p>
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!name.trim()} type="submit">
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface RenameItemDialogProps {
  currentName: string;
  open: boolean;
  onClose: () => void;
  onRename: (newName: string) => void;
}

export function RenameItemDialog({ currentName, open, onClose, onRename }: RenameItemDialogProps) {
  const [name, setName] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(currentName);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [currentName, open]);

  const handleSubmit = useCallback(
    (evt: React.FormEvent) => {
      evt.preventDefault();
      if (name.trim() && name.trim() !== currentName) {
        onRename(name.trim());
        onClose();
      }
    },
    [currentName, name, onClose, onRename],
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-zinc-900 text-zinc-100">
        <DialogHeader>
          <DialogTitle>Rename</DialogTitle>
          <DialogDescription className="text-zinc-400">Enter a new name</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <Input
              className="border-zinc-600 bg-zinc-800"
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!name.trim() || name.trim() === currentName} type="submit">
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
