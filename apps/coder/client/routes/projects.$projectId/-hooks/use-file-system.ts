import { useCallback, useState } from "react";

export interface FileSystemItem {
  children?: string[];
  content?: string;
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  type: "file" | "folder";
}

export interface FileSystemState {
  activeFileId: string | null;
  items: Record<string, FileSystemItem>;
  openFileIds: string[];
  rootIds: string[];
}

const generateId = () => Math.random().toString(36).substring(2, 9);

function getParentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return `/${parts.join("/")}`;
}

const DEFAULT_STATE: FileSystemState = {
  activeFileId: null,
  items: {},
  openFileIds: [],
  rootIds: [],
};

export function useFileSystem(initialFiles?: { content: string; path: string }[]) {
  const [state, setState] = useState<FileSystemState>(() => {
    if (!initialFiles || initialFiles.length === 0) {
      return DEFAULT_STATE;
    }

    const items: Record<string, FileSystemItem> = {};
    const rootIds: string[] = [];
    const pathToId: Record<string, string> = {};

    // First pass: create all items
    for (const file of initialFiles) {
      const pathParts = file.path.split("/").filter(Boolean);
      let currentPath = "";

      for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i];
        const isFile = i === pathParts.length - 1;
        currentPath = `${currentPath}/${part}`;

        if (pathToId[currentPath]) continue;

        const id = generateId();
        pathToId[currentPath] = id;

        const parentPath = getParentPath(currentPath);
        const parentId = parentPath === "/" ? null : pathToId[parentPath] || null;

        items[id] = {
          children: isFile ? undefined : [],
          content: isFile ? file.content : undefined,
          id,
          name: part,
          parentId,
          path: currentPath,
          type: isFile ? "file" : "folder",
        };

        if (parentId === null) {
          rootIds.push(id);
        } else if (items[parentId]) {
          items[parentId].children = items[parentId].children || [];
          if (!items[parentId].children!.includes(id)) {
            items[parentId].children!.push(id);
          }
        }
      }
    }

    // Set first file as active
    const firstFile = Object.values(items).find((item) => item.type === "file");

    return {
      activeFileId: firstFile?.id || null,
      items,
      openFileIds: firstFile ? [firstFile.id] : [],
      rootIds,
    };
  });

  const createFile = useCallback((path: string, content: string = "") => {
    setState((prev) => {
      const pathParts = path.split("/").filter(Boolean);
      const fileName = pathParts[pathParts.length - 1];
      const parentPath = getParentPath(path);

      // Find parent folder
      let parentId: string | null = null;
      for (const item of Object.values(prev.items)) {
        if (item.path === parentPath && item.type === "folder") {
          parentId = item.id;
          break;
        }
      }

      const id = generateId();
      const newItem: FileSystemItem = {
        content,
        id,
        name: fileName,
        parentId,
        path,
        type: "file",
      };

      const newItems = { ...prev.items, [id]: newItem };

      // Update parent's children
      if (parentId && newItems[parentId]) {
        newItems[parentId] = {
          ...newItems[parentId],
          children: [...(newItems[parentId].children || []), id],
        };
      }

      const newRootIds = parentId === null ? [...prev.rootIds, id] : prev.rootIds;

      return {
        ...prev,
        activeFileId: id,
        items: newItems,
        openFileIds: [...prev.openFileIds, id],
        rootIds: newRootIds,
      };
    });
  }, []);

  const createFolder = useCallback((path: string) => {
    setState((prev) => {
      const pathParts = path.split("/").filter(Boolean);
      const folderName = pathParts[pathParts.length - 1];
      const parentPath = getParentPath(path);

      let parentId: string | null = null;
      for (const item of Object.values(prev.items)) {
        if (item.path === parentPath && item.type === "folder") {
          parentId = item.id;
          break;
        }
      }

      const id = generateId();
      const newItem: FileSystemItem = {
        children: [],
        id,
        name: folderName,
        parentId,
        path,
        type: "folder",
      };

      const newItems = { ...prev.items, [id]: newItem };

      if (parentId && newItems[parentId]) {
        newItems[parentId] = {
          ...newItems[parentId],
          children: [...(newItems[parentId].children || []), id],
        };
      }

      const newRootIds = parentId === null ? [...prev.rootIds, id] : prev.rootIds;

      return {
        ...prev,
        items: newItems,
        rootIds: newRootIds,
      };
    });
  }, []);

  const deleteItem = useCallback((id: string) => {
    setState((prev) => {
      const item = prev.items[id];
      if (!item) return prev;

      const idsToDelete = new Set<string>();
      const collectIds = (itemId: string) => {
        idsToDelete.add(itemId);
        const i = prev.items[itemId];
        if (i?.children) {
          i.children.forEach(collectIds);
        }
      };
      collectIds(id);

      const newItems = { ...prev.items };
      for (const deleteId of idsToDelete) {
        delete newItems[deleteId];
      }

      // Update parent's children
      if (item.parentId && newItems[item.parentId]) {
        newItems[item.parentId] = {
          ...newItems[item.parentId],
          children: newItems[item.parentId].children?.filter((cId) => cId !== id),
        };
      }

      const newRootIds = prev.rootIds.filter((rId) => !idsToDelete.has(rId));
      const newOpenFileIds = prev.openFileIds.filter((oId) => !idsToDelete.has(oId));
      const newActiveFileId = idsToDelete.has(prev.activeFileId || "")
        ? newOpenFileIds[0] || null
        : prev.activeFileId;

      return {
        ...prev,
        activeFileId: newActiveFileId,
        items: newItems,
        openFileIds: newOpenFileIds,
        rootIds: newRootIds,
      };
    });
  }, []);

  const renameItem = useCallback((id: string, newName: string) => {
    setState((prev) => {
      const item = prev.items[id];
      if (!item) return prev;

      const parentPath = getParentPath(item.path);
      const newPath = parentPath === "/" ? `/${newName}` : `${parentPath}/${newName}`;

      const updatePaths = (itemId: string, basePath: string): Record<string, FileSystemItem> => {
        const i = prev.items[itemId];
        if (!i) return {};

        const updatedPath = itemId === id ? newPath : `${basePath}/${i.name}`;
        let result: Record<string, FileSystemItem> = {
          [itemId]: { ...i, name: itemId === id ? newName : i.name, path: updatedPath },
        };

        if (i.children) {
          for (const childId of i.children) {
            result = { ...result, ...updatePaths(childId, updatedPath) };
          }
        }

        return result;
      };

      const updatedItems = updatePaths(id, parentPath);

      return {
        ...prev,
        items: { ...prev.items, ...updatedItems },
      };
    });
  }, []);

  const updateFileContent = useCallback((id: string, content: string) => {
    setState((prev) => {
      const item = prev.items[id];
      if (!item || item.type !== "file") return prev;

      return {
        ...prev,
        items: {
          ...prev.items,
          [id]: { ...item, content },
        },
      };
    });
  }, []);

  const setActiveFile = useCallback((id: string | null) => {
    setState((prev) => {
      if (id === null) {
        return { ...prev, activeFileId: null };
      }

      const item = prev.items[id];
      if (!item || item.type !== "file") return prev;

      const openFileIds = prev.openFileIds.includes(id)
        ? prev.openFileIds
        : [...prev.openFileIds, id];

      return {
        ...prev,
        activeFileId: id,
        openFileIds,
      };
    });
  }, []);

  const closeFile = useCallback((id: string) => {
    setState((prev) => {
      const newOpenFileIds = prev.openFileIds.filter((oId) => oId !== id);
      const newActiveFileId =
        prev.activeFileId === id
          ? newOpenFileIds[newOpenFileIds.length - 1] || null
          : prev.activeFileId;

      return {
        ...prev,
        activeFileId: newActiveFileId,
        openFileIds: newOpenFileIds,
      };
    });
  }, []);

  const getFilesForBuild = useCallback(() => {
    return Object.values(state.items)
      .filter((item) => item.type === "file")
      .map((item) => ({
        content: item.content || "",
        path: item.path,
      }));
  }, [state.items]);

  const getFileTree = useCallback(() => {
    const buildTree = (ids: string[]): FileSystemItem[] => {
      return ids
        .map((id) => state.items[id])
        .filter(Boolean)
        .sort((a, b) => {
          // Folders first, then alphabetical
          if (a.type !== b.type) {
            return a.type === "folder" ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
    };

    return buildTree(state.rootIds);
  }, [state.items, state.rootIds]);

  return {
    activeFile: state.activeFileId ? state.items[state.activeFileId] : null,
    activeFileId: state.activeFileId,
    closeFile,
    createFile,
    createFolder,
    deleteItem,
    getFilesForBuild,
    getFileTree,
    items: state.items,
    openFileIds: state.openFileIds,
    openFiles: state.openFileIds.map((id) => state.items[id]).filter(Boolean),
    renameItem,
    rootIds: state.rootIds,
    setActiveFile,
    updateFileContent,
  };
}
