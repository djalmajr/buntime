/**
 * Dialogs used by the FileBrowser: new-folder, rename, move, confirm-delete.
 * Kept together to minimise file count — each is small and self-contained.
 */

import { useEffect, useMemo, useState } from "react";
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
import type { ClientPathPolicy } from "../path-policy";

// ---------------------------------------------------------------------------
// New folder dialog — policy-aware (workers semver / plugins free-form).
// ---------------------------------------------------------------------------

interface NewFolderDialogProps {
  open: boolean;
  parentPath: string;
  policy: ClientPathPolicy;
  onClose: () => void;
  onCreate: (name: string) => void;
}

export function NewFolderDialog({
  open,
  parentPath,
  policy,
  onClose,
  onCreate,
}: NewFolderDialogProps) {
  const [name, setName] = useState("");

  const error = useMemo(
    () => (name.trim() ? policy.validateFolderName(parentPath, name) : null),
    [name, parentPath, policy],
  );
  const isValid = name.trim().length > 0 && !error;
  const hints = useMemo(() => policy.folderHints(parentPath), [parentPath, policy]);

  const handleCreate = () => {
    if (!isValid) return;
    onCreate(name.trim());
    setName("");
    onClose();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setName("");
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>{hints.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder={hints.placeholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && isValid) handleCreate();
            }}
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!isValid} onClick={handleCreate}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Rename dialog.
// ---------------------------------------------------------------------------

interface RenameDialogProps {
  currentName: string;
  open: boolean;
  onClose: () => void;
  onRename: (newName: string) => void;
}

export function RenameDialog({ currentName, open, onClose, onRename }: RenameDialogProps) {
  const [name, setName] = useState(currentName);

  useEffect(() => {
    setName(currentName);
  }, [currentName]);

  const handleRename = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== currentName) {
      onRename(trimmed);
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename</DialogTitle>
          <DialogDescription>Enter a new name for this item.</DialogDescription>
        </DialogHeader>
        <Input
          placeholder="New name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || name.trim() === currentName} onClick={handleRename}>
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Move dialog.
// ---------------------------------------------------------------------------

interface MoveDialogProps {
  currentPath: string;
  open: boolean;
  onClose: () => void;
  onMove: (destPath: string) => void;
}

export function MoveDialog({ currentPath, open, onClose, onMove }: MoveDialogProps) {
  const defaultDest = currentPath.includes("/")
    ? currentPath.substring(0, currentPath.lastIndexOf("/"))
    : "";
  const [destPath, setDestPath] = useState(defaultDest);

  useEffect(() => {
    setDestPath(defaultDest);
  }, [defaultDest]);

  const currentParent = defaultDest;

  const handleMove = () => {
    const trimmed = destPath.trim();
    if (trimmed !== currentParent) {
      onMove(trimmed);
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move item</DialogTitle>
          <DialogDescription>Enter the destination path (e.g., my-app/1.0.0).</DialogDescription>
        </DialogHeader>
        <Input
          placeholder="Destination path"
          value={destPath}
          onChange={(e) => setDestPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleMove();
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={destPath.trim() === currentParent} onClick={handleMove}>
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Confirm delete (single + batch).
// ---------------------------------------------------------------------------

interface ConfirmDeleteDialogProps {
  description: string;
  open: boolean;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDeleteDialog({
  description,
  open,
  title,
  onCancel,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
