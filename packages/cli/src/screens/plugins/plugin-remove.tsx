import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { useEffect, useState } from "react";
import { Dialog } from "../../components/dialog.js";
import { Label } from "../../components/label.js";
import { Layout } from "../../components/layout.js";
import { Logo } from "../../components/logo.js";
import { useTui } from "../../context/tui-context.js";
import type { PluginInfo } from "../../lib/api-client.js";
import { Theme } from "../../lib/theme.js";

type State =
  | "confirming"
  | "error"
  | "loading"
  | "removing"
  | "select_plugin"
  | "select_versions"
  | "success";

export function PluginRemoveScreen() {
  const { api, goBack } = useTui();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedPluginIndex, setSelectedPluginIndex] = useState(0);
  const [selectedVersions, setSelectedVersions] = useState<Set<string>>(new Set());
  const [allVersions, setAllVersions] = useState(false);
  const [versionIndex, setVersionIndex] = useState(0);
  const [removedVersions, setRemovedVersions] = useState<string[]>([]);

  useEffect(() => {
    fetchPlugins();
  }, [api]);

  const fetchPlugins = async () => {
    if (!api) return;

    setState("loading");
    try {
      const data = await api.listPlugins();
      setPlugins(data);
      setState(data.length === 0 ? "error" : "select_plugin");
      if (data.length === 0) {
        setError("No plugins installed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  };

  const handleRemove = async () => {
    if (!api) return;

    const plugin = plugins[selectedPluginIndex];
    if (!plugin) return;

    const versionsToRemove = allVersions ? plugin.versions : Array.from(selectedVersions);

    setState("removing");

    try {
      for (const version of versionsToRemove) {
        await api.removePlugin(plugin.name, version);
      }
      setRemovedVersions(versionsToRemove);
      setState("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  };

  useInput((input, key) => {
    if (key.escape) {
      if (state === "select_versions") {
        setState("select_plugin");
        setSelectedVersions(new Set());
        setAllVersions(false);
      } else {
        goBack();
      }
      return;
    }

    if (state === "select_plugin") {
      const len = plugins.length;
      if (key.upArrow || input === "k") {
        setSelectedPluginIndex((prev) => (prev - 1 + len) % len);
      } else if (key.downArrow || input === "j") {
        setSelectedPluginIndex((prev) => (prev + 1) % len);
      } else if (key.return) {
        const plugin = plugins[selectedPluginIndex];
        if (plugin) {
          if (plugin.versions.length === 1) {
            setSelectedVersions(new Set(plugin.versions));
            setState("confirming");
          } else {
            setState("select_versions");
          }
        }
      }
      return;
    }

    if (state === "select_versions") {
      const plugin = plugins[selectedPluginIndex];
      if (!plugin) return;

      const totalOptions = plugin.versions.length + 1;

      if (key.upArrow || input === "k") {
        setVersionIndex((prev) => (prev - 1 + totalOptions) % totalOptions);
      } else if (key.downArrow || input === "j") {
        setVersionIndex((prev) => (prev + 1) % totalOptions);
      } else if (input === " ") {
        if (versionIndex === 0) {
          setAllVersions((prev) => !prev);
          setSelectedVersions(new Set());
        } else {
          const version = plugin.versions[versionIndex - 1];
          if (version) {
            setAllVersions(false);
            setSelectedVersions((prev) => {
              const next = new Set(prev);
              if (next.has(version)) {
                next.delete(version);
              } else {
                next.add(version);
              }
              return next;
            });
          }
        }
      } else if (key.return) {
        if (allVersions || selectedVersions.size > 0) {
          setState("confirming");
        }
      }
      return;
    }

    if (state === "success" || state === "error") {
      if (key.return) {
        goBack();
      }
    }
  });

  const handleDialogSelect = (value: string) => {
    if (value === "confirm") {
      handleRemove();
    } else {
      setState("select_versions");
    }
  };

  const selectedPlugin = plugins[selectedPluginIndex];
  const versionsToRemove = allVersions
    ? (selectedPlugin?.versions ?? [])
    : Array.from(selectedVersions);

  const shortcuts: Partial<Record<State, { action: string; key: string }[]>> = {
    select_versions: [{ action: "Toggle selection", key: "Space" }],
  };

  return (
    <Layout shortcuts={shortcuts[state] ?? []}>
      <Logo />
      {state === "loading" && (
        <Box>
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Label> Loading plugins...</Label>
        </Box>
      )}

      {state === "select_plugin" && (
        <>
          <Label bold>Select a plugin to remove:</Label>
          <Box flexDirection="column" marginTop={1}>
            {plugins.map((plugin, index) => (
              <Box key={plugin.name} gap={2}>
                <Label selected={index === selectedPluginIndex}>
                  {index === selectedPluginIndex ? "▸" : " "} {plugin.name}
                </Label>
                <Label muted>
                  ({plugin.versions.length} version
                  {plugin.versions.length !== 1 ? "s" : ""})
                </Label>
              </Box>
            ))}
          </Box>
        </>
      )}

      {state === "select_versions" && selectedPlugin && (
        <>
          <Label bold>{selectedPlugin.name}</Label>
          <Box marginTop={1}>
            <Label>Select versions to remove:</Label>
          </Box>
          <Box flexDirection="column" marginTop={1}>
            <Box>
              <Label selected={versionIndex === 0}>
                {versionIndex === 0 ? "▸" : " "} ({allVersions ? "*" : " "}) All versions
              </Label>
            </Box>
            <Box marginY={0}>
              <Text color={Theme.border}>{"─".repeat(50)}</Text>
            </Box>
            {selectedPlugin.versions.map((version, index) => (
              <Box key={version}>
                <Label selected={versionIndex === index + 1}>
                  {versionIndex === index + 1 ? "▸" : " "} [
                  {selectedVersions.has(version) ? "x" : " "}] {version}
                </Label>
              </Box>
            ))}
          </Box>
          <Box justifyContent="flex-end" marginTop={1}>
            <Label muted>
              Selected:{" "}
              {allVersions
                ? `All (${selectedPlugin.versions.length} versions)`
                : `${selectedVersions.size} version${selectedVersions.size !== 1 ? "s" : ""}`}
            </Label>
          </Box>
        </>
      )}

      {state === "confirming" && selectedPlugin && (
        <Box alignItems="center" flexDirection="column">
          <Dialog
            buttons={[
              { label: "Cancel", value: "cancel" },
              {
                label: allVersions ? "Remove All" : "Remove",
                value: "confirm",
              },
            ]}
            message={`Versions to be removed:\n${versionsToRemove.map((v) => `  - ${v}`).join("\n")}\n\nThis action cannot be undone.`}
            title={`Are you sure you want to remove ${selectedPlugin.name}?`}
            onSelect={handleDialogSelect}
          />
        </Box>
      )}

      {state === "removing" && (
        <Box alignItems="center" flexGrow={1} justifyContent="center">
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Label> Removing plugin...</Label>
        </Box>
      )}

      {state === "success" && selectedPlugin && (
        <Box alignItems="center" flexDirection="column" flexGrow={1} justifyContent="center">
          <Text color="green">+ Plugin removed successfully</Text>
          <Box marginTop={1}>
            <Label selected>{selectedPlugin.name}</Label>
          </Box>
          <Label muted>Removed: {removedVersions.join(", ")}</Label>
        </Box>
      )}

      {state === "error" && (
        <Box alignItems="center" flexDirection="column" flexGrow={1} justifyContent="center">
          <Text color="red">x Error</Text>
          <Box marginTop={1}>
            <Label muted>{error}</Label>
          </Box>
        </Box>
      )}
    </Layout>
  );
}
