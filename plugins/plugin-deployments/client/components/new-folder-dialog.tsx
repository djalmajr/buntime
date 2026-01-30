import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { valid } from "semver";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

// kebab-case: lowercase letters, numbers, hyphens (not at start/end)
const KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// Semantic versioning: major.minor.patch[-prerelease] (with optional v prefix)
// Supports: 1.0.0, v1.0.0, 1.0.0-rc.1, 1.0.0-alpha, 1.0.0-beta.2, etc.
const SEMVER_REGEX =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*)?$/;

/**
 * Check if a folder name is in flat format (app-name@version)
 */
function isFlatFormat(name: string): boolean {
  const atIndex = name.lastIndexOf("@");
  if (atIndex === -1) return false;

  const appName = name.slice(0, atIndex);
  const version = name.slice(atIndex + 1);

  return KEBAB_CASE_REGEX.test(appName) && valid(version) !== null;
}

interface NewFolderDialogProps {
  /**
   * Depth level in the folder hierarchy:
   * - 1: inside virtual root folder - create app or app@version
   * - 2: inside app folder (nested, not inside version) - create version
   * - 2+: inside version (flat or nested) - create any folder
   */
  depth: number;
  /** Whether we're inside a version folder (flat or nested) */
  isInsideVersion: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
  open: boolean;
}

export function NewFolderDialog({
  depth,
  isInsideVersion,
  onClose,
  onCreate,
  open,
}: NewFolderDialogProps) {
  const { t } = useTranslation("deployments");
  const [name, setName] = useState("");

  // Determine folder type based on depth and whether inside version
  // - depth 0 or 1: create app or app@version (root or inside virtual root folder)
  // - depth 2+ and inside version: create any folder
  // - depth 2 and NOT inside version (nested app folder): create version
  const folderType = useMemo(() => {
    if (depth <= 1) return "app";
    if (isInsideVersion) return "any";
    return "version";
  }, [depth, isInsideVersion]);

  const validation = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return { error: null, isValid: false };

    if (folderType === "app") {
      // Inside virtual root folder -> kebab-case (app-name) OR flat format (app-name@version)
      const isKebab = KEBAB_CASE_REGEX.test(trimmed);
      const isFlat = isFlatFormat(trimmed);
      if (!isKebab && !isFlat) {
        return { error: t("validation.appOrFlat"), isValid: false };
      }
    } else if (folderType === "version") {
      // Inside nested app folder (not in version) -> semver
      if (!SEMVER_REGEX.test(trimmed)) {
        return { error: t("validation.semver"), isValid: false };
      }
    }
    // folderType === "any" -> any name allowed

    return { error: null, isValid: true };
  }, [folderType, name, t]);

  const placeholder = useMemo(() => {
    if (folderType === "app") return t("newFolder.placeholderApp");
    if (folderType === "version") return t("newFolder.placeholderVersion");
    return t("newFolder.placeholder");
  }, [folderType, t]);

  const description = useMemo(() => {
    if (folderType === "app") return t("newFolder.descriptionApp");
    if (folderType === "version") return t("newFolder.descriptionVersion");
    return t("newFolder.description");
  }, [folderType, t]);

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

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setName("");
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("newFolder.title")}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
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
