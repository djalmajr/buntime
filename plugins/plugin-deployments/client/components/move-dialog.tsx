import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@zomme/shadcn-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface MoveDialogProps {
  currentPath: string;
  onClose: () => void;
  onMove: (destPath: string) => void;
  open: boolean;
}

export function MoveDialog({ currentPath, onClose, onMove, open }: MoveDialogProps) {
  const { t } = useTranslation("deployments");

  // Default to parent directory
  const defaultDest = currentPath.includes("/")
    ? currentPath.substring(0, currentPath.lastIndexOf("/"))
    : "";

  const [destPath, setDestPath] = useState(defaultDest);

  useEffect(() => {
    const newDefault = currentPath.includes("/")
      ? currentPath.substring(0, currentPath.lastIndexOf("/"))
      : "";
    setDestPath(newDefault);
  }, [currentPath]);

  const handleMove = () => {
    const trimmed = destPath.trim();
    // Get the parent directory of current path
    const currentParent = currentPath.includes("/")
      ? currentPath.substring(0, currentPath.lastIndexOf("/"))
      : "";

    // Only move if destination is different from current parent
    if (trimmed !== currentParent) {
      onMove(trimmed);
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleMove();
    }
  };

  const currentParent = currentPath.includes("/")
    ? currentPath.substring(0, currentPath.lastIndexOf("/"))
    : "";

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("move.title")}</DialogTitle>
          <DialogDescription>{t("move.description")}</DialogDescription>
        </DialogHeader>
        <Input
          placeholder={t("move.placeholder")}
          value={destPath}
          onChange={(e) => setDestPath(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("actions.cancel")}
          </Button>
          <Button disabled={destPath.trim() === currentParent} onClick={handleMove}>
            {t("actions.move")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
