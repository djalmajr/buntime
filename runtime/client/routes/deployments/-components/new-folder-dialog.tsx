import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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

// kebab-case: lowercase letters, numbers, hyphens (not at start/end)
const KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// Semantic versioning: major.minor.patch[-prerelease] (with optional v prefix)
// Supports: 1.0.0, v1.0.0, 1.0.0-rc.1, 1.0.0-alpha, 1.0.0-beta.2, etc.
const SEMVER_REGEX =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*)?$/;

interface NewFolderDialogProps {
  depth: number;
  onClose: () => void;
  onCreate: (name: string) => void;
  open: boolean;
}

export function NewFolderDialog({ depth, onClose, onCreate, open }: NewFolderDialogProps) {
  const { t } = useTranslation("deployments");
  const [name, setName] = useState("");

  const validation = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return { error: null, isValid: false };

    // depth 0 = root (app name) -> kebab-case
    if (depth === 0) {
      if (!KEBAB_CASE_REGEX.test(trimmed)) {
        return { error: t("validation.kebabCase"), isValid: false };
      }
    }
    // depth 1 = inside app (version) -> semver
    else if (depth === 1) {
      if (!SEMVER_REGEX.test(trimmed)) {
        return { error: t("validation.semver"), isValid: false };
      }
    }
    // depth >= 2 = inside version -> any name allowed

    return { error: null, isValid: true };
  }, [depth, name, t]);

  const placeholder = useMemo(() => {
    if (depth === 0) return t("newFolder.placeholderApp");
    if (depth === 1) return t("newFolder.placeholderVersion");
    return t("newFolder.placeholder");
  }, [depth, t]);

  const description = useMemo(() => {
    if (depth === 0) return t("newFolder.descriptionApp");
    if (depth === 1) return t("newFolder.descriptionVersion");
    return t("newFolder.description");
  }, [depth, t]);

  const handleCreate = () => {
    if (validation.isValid) {
      onCreate(name.trim());
      setName("");
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && validation.isValid) {
      handleCreate();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setName("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("newFolder.title")}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            placeholder={placeholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {validation.error && <p className="text-sm text-destructive">{validation.error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("actions.cancel")}
          </Button>
          <Button disabled={!validation.isValid} onClick={handleCreate}>
            {t("actions.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
