import { Link, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "~/components/icon";
import { Sidebar, SidebarSection } from "~/components/sidebar";
import { Button } from "~/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "~/components/ui/resizable";
import { Switch } from "~/components/ui/switch";
import { useEditorTheme } from "~/hooks/use-editor-theme";
import { getProjectById, updateProjectById } from "~/hooks/use-projects";
import { ActivityBar, type ActivityView } from "./projects.$projectId/-components/activity-bar";
import { CodeEditor } from "./projects.$projectId/-components/code-editor/code-editor";
import {
  CreateItemDialog,
  RenameItemDialog,
} from "./projects.$projectId/-components/create-item-dialog";
import { DependenciesPanel } from "./projects.$projectId/-components/dependencies-panel";
import { FileTabs } from "./projects.$projectId/-components/file-tabs";
import { FileTree } from "./projects.$projectId/-components/file-tree";
import { Preview } from "./projects.$projectId/-components/preview";
import { SearchPanel } from "./projects.$projectId/-components/search-panel";
import { useDependencies } from "./projects.$projectId/-hooks/use-dependencies";
import { useEsbuild } from "./projects.$projectId/-hooks/use-esbuild";
import { useFileSystem } from "./projects.$projectId/-hooks/use-file-system";

interface DialogState {
  parentPath: string;
  type: "file" | "folder" | null;
}

interface RenameState {
  currentName: string;
  id: string | null;
}

function ProjectEditorPage() {
  const { projectId } = Route.useParams();

  const [activeView, setActiveView] = useState<ActivityView>("explorer");
  const [autoRun, setAutoRun] = useState(false);
  const [builtCode, setBuiltCode] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<DialogState>({
    parentPath: "/",
    type: null,
  });
  const [renameState, setRenameState] = useState<RenameState>({
    currentName: "",
    id: null,
  });

  const autoRunTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load project
  const project = getProjectById(projectId);

  // Editor theme hook
  const { theme: editorTheme } = useEditorTheme();

  // File system hook - initialized with project files
  const {
    activeFile,
    activeFileId,
    closeFile,
    createFile,
    createFolder,
    deleteItem,
    getFilesForBuild,
    items,
    openFiles,
    renameItem,
    rootIds,
    setActiveFile,
    updateFileContent,
  } = useFileSystem(project?.files);

  // Dependencies hook - initialized with project dependencies
  const {
    addDependency,
    clearSearch,
    dependencies,
    isSearching,
    removeDependency,
    searchPackages,
    searchResults,
  } = useDependencies(project?.dependencies);

  // Build hook - auto-detects entry point (index.tsx, index.ts, etc.)
  const { build, error, isReady } = useEsbuild({
    dependencies,
    files: getFilesForBuild(),
  });

  // Save project when files or dependencies change
  useEffect(() => {
    if (!project) return;

    const files = getFilesForBuild();
    updateProjectById(projectId, { dependencies, files });
  }, [dependencies, getFilesForBuild, project, projectId]);

  // Handlers
  const handleRun = useCallback(async () => {
    const result = await build();
    if (result) {
      setBuiltCode(result);
    }
  }, [build]);

  const handleCodeChange = useCallback(
    (newCode: string) => {
      if (activeFileId) {
        updateFileContent(activeFileId, newCode);
      }
    },
    [activeFileId, updateFileContent],
  );

  // Create a hash of file contents to trigger auto-run on changes
  const filesHash = JSON.stringify(
    Object.values(items)
      .filter((item) => item.type === "file")
      .map((item) => item.content),
  );

  // Auto-run effect with debounce
  // biome-ignore lint/correctness/useExhaustiveDependencies: filesHash triggers rebuild on file changes
  useEffect(() => {
    if (!autoRun || !isReady) return;

    if (autoRunTimeoutRef.current) {
      clearTimeout(autoRunTimeoutRef.current);
    }

    autoRunTimeoutRef.current = setTimeout(async () => {
      const result = await build();
      if (result) {
        setBuiltCode(result);
      }
    }, 500);

    return () => {
      if (autoRunTimeoutRef.current) {
        clearTimeout(autoRunTimeoutRef.current);
      }
    };
  }, [autoRun, build, filesHash, isReady]);

  const handleCreateFile = useCallback((parentPath: string) => {
    setDialogState({ parentPath, type: "file" });
  }, []);

  const handleCreateFolder = useCallback((parentPath: string) => {
    setDialogState({ parentPath, type: "folder" });
  }, []);

  const handleDialogCreate = useCallback(
    (name: string) => {
      const fullPath =
        dialogState.parentPath === "/" ? `/${name}` : `${dialogState.parentPath}/${name}`;

      if (dialogState.type === "file") {
        createFile(fullPath, "");
      } else if (dialogState.type === "folder") {
        createFolder(fullPath);
      }
    },
    [createFile, createFolder, dialogState.parentPath, dialogState.type],
  );

  const handleRenameRequest = useCallback(
    (id: string) => {
      const item = items[id];
      if (item) {
        setRenameState({ currentName: item.name, id });
      }
    },
    [items],
  );

  const handleRename = useCallback(
    (newName: string) => {
      if (renameState.id) {
        renameItem(renameState.id, newName);
      }
    },
    [renameItem, renameState.id],
  );

  // Handle project not found
  if (!project) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <Icon className="text-muted-foreground size-16" name="lucide:folder-x" />
        <h1 className="text-xl font-semibold">Project Not Found</h1>
        <p className="text-muted-foreground">The project you're looking for doesn't exist.</p>
        <Button asChild>
          <Link to="/">Back to Projects</Link>
        </Button>
      </div>
    );
  }

  const getSidebarTitle = () => {
    switch (activeView) {
      case "dependencies":
        return "Dependencies";
      case "explorer":
        return "Explorer";
      case "search":
        return "Search";
    }
  };

  const renderSidebarContent = () => {
    switch (activeView) {
      case "dependencies":
        return (
          <DependenciesPanel
            dependencies={dependencies}
            isSearching={isSearching}
            searchResults={searchResults}
            onAddDependency={addDependency}
            onClearSearch={clearSearch}
            onRemoveDependency={removeDependency}
            onSearch={searchPackages}
          />
        );
      case "explorer":
        return (
          <SidebarSection defaultOpen title="Files">
            <FileTree
              activeFileId={activeFileId}
              items={items}
              rootIds={rootIds}
              onCreateFile={handleCreateFile}
              onCreateFolder={handleCreateFolder}
              onDeleteItem={deleteItem}
              onRenameItem={handleRenameRequest}
              onSelectFile={setActiveFile}
            />
          </SidebarSection>
        );
      case "search":
        return <SearchPanel />;
    }
  };

  return (
    <>
      {/* Main content */}
      <main className="flex flex-1 overflow-hidden">
        {/* Activity Bar */}
        <ActivityBar activeView={activeView} onViewChange={setActiveView} />

        {/* Resizable Panels */}
        <ResizablePanelGroup className="flex-1" direction="horizontal">
          {/* Sidebar Panel */}
          <ResizablePanel collapsedSize={0} collapsible defaultSize={20} maxSize={40} minSize={10}>
            <Sidebar title={getSidebarTitle()}>{renderSidebarContent()}</Sidebar>
          </ResizablePanel>

          <ResizableHandle />

          {/* Editor Panel */}
          <ResizablePanel defaultSize={40} minSize={20}>
            <div className="flex h-full flex-col">
              <FileTabs
                activeFileId={activeFileId}
                openFiles={openFiles}
                onCloseFile={closeFile}
                onSelectFile={setActiveFile}
              />
              <div className="flex-1">
                {activeFile ? (
                  <CodeEditor
                    path={activeFile.path}
                    theme={editorTheme}
                    value={activeFile.content || ""}
                    onChange={handleCodeChange}
                  />
                ) : (
                  <div className="text-muted-foreground flex h-full items-center justify-center">
                    Select a file to edit
                  </div>
                )}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle />

          {/* Preview Panel */}
          <ResizablePanel collapsedSize={0} collapsible defaultSize={40} minSize={20}>
            <div className="bg-sidebar border-sidebar-border flex h-full flex-col border-l">
              <div className="bg-sidebar border-sidebar-border flex h-9 items-center justify-between border-b px-4">
                <span className="text-sm font-medium">Preview</span>
                <div className="flex items-center gap-3">
                  <div className="flex cursor-pointer items-center gap-1.5">
                    <Switch
                      checked={autoRun}
                      disabled={!isReady}
                      id="auto-run-switch"
                      onCheckedChange={setAutoRun}
                    />
                    <label className="text-sidebar-foreground/70 text-xs" htmlFor="auto-run-switch">
                      Auto
                    </label>
                  </div>
                  <Button
                    className="h-6 px-2 text-xs"
                    disabled={!isReady || autoRun}
                    size="sm"
                    onClick={handleRun}
                  >
                    Run
                  </Button>
                </div>
              </div>
              <div className="flex-1">
                <Preview code={builtCode} error={error} />
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>

      {/* Dialogs */}
      <CreateItemDialog
        open={dialogState.type !== null}
        parentPath={dialogState.parentPath}
        type={dialogState.type || "file"}
        onClose={() => setDialogState({ parentPath: "/", type: null })}
        onCreate={handleDialogCreate}
      />

      <RenameItemDialog
        currentName={renameState.currentName}
        open={renameState.id !== null}
        onClose={() => setRenameState({ currentName: "", id: null })}
        onRename={handleRename}
      />
    </>
  );
}

export const Route = createFileRoute("/projects/$projectId")({
  component: ProjectEditorPage,
});
