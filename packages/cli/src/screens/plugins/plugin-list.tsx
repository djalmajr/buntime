import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { useEffect, useState } from "react";
import { Label } from "../../components/label.js";
import { Layout } from "../../components/layout.js";
import { Logo } from "../../components/logo.js";
import { useTui } from "../../context/tui-context.js";
import type { PluginInfo } from "../../lib/api-client.js";

interface DisplayPlugin {
  enabled: boolean;
  name: string;
  path: string;
  version: string;
}

export function PluginListScreen() {
  const { api, currentState, goBack, navigate, updateScreenState } = useTui();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(currentState?.selectedIndex ?? 0);
  const [toggling, setToggling] = useState(false);

  // Save selection state for navigation back
  useEffect(() => {
    updateScreenState({ selectedIndex });
  }, [selectedIndex, updateScreenState]);

  // Flatten plugins to show each plugin (not version)
  const displayPlugins: DisplayPlugin[] = plugins.map((plugin) => ({
    enabled: plugin.enabled,
    name: plugin.name,
    path: plugin.path,
    version: plugin.versions[0] ?? "unknown",
  }));

  useInput((input, key) => {
    if (toggling) return;

    if (key.escape) {
      goBack();
      return;
    }
    if (input === "r") {
      fetchPlugins();
      return;
    }
    if (input === "i") {
      navigate({ type: "plugin_install" });
      return;
    }
    if (input === "d" && plugins.length > 0) {
      navigate({ type: "plugin_remove" });
      return;
    }
    if (key.upArrow || input === "k") {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((prev) => Math.min(displayPlugins.length - 1, prev + 1));
      return;
    }
    if (input === " " || key.return) {
      togglePlugin();
      return;
    }
  });

  const fetchPlugins = async () => {
    if (!api) return;

    setLoading(true);
    setError(null);

    try {
      const data = await api.listPlugins();
      setPlugins(data);
      // Clamp selected index to valid range
      setSelectedIndex((prev) => Math.min(prev, Math.max(0, data.length - 1)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const togglePlugin = async () => {
    if (!api || displayPlugins.length === 0) return;

    const plugin = displayPlugins[selectedIndex];
    if (!plugin) return;

    setToggling(true);

    try {
      if (plugin.enabled) {
        await api.disablePlugin(plugin.name);
      } else {
        await api.enablePlugin(plugin.name);
      }
      // Refresh the list
      await fetchPlugins();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle plugin");
    } finally {
      setToggling(false);
    }
  };

  useEffect(() => {
    fetchPlugins();
  }, [api]);

  const shortcuts = [
    { action: "Toggle", key: "Space" },
    { action: "Install", key: "i" },
    ...(plugins.length > 0 ? [{ action: "Delete", key: "d" }] : []),
    { action: "Refresh", key: "r" },
  ];

  return (
    <Layout shortcuts={shortcuts}>
      <Logo />
      {loading && (
        <Box>
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Label> Loading plugins...</Label>
        </Box>
      )}

      {error && (
        <Box flexDirection="column">
          <Text color="red">Error: {error}</Text>
          <Label muted>Press 'r' to retry</Label>
        </Box>
      )}

      {!loading && !error && displayPlugins.length === 0 && (
        <Box alignItems="center" flexDirection="column" marginTop={1}>
          <Text color="red">x Error</Text>
          <Box marginTop={1}>
            <Label muted>No plugins installed</Label>
          </Box>
        </Box>
      )}

      {!loading && !error && displayPlugins.length > 0 && (
        <>
          <Label selected bold>
            Installed Plugins ({displayPlugins.length})
          </Label>
          <Box flexDirection="column" marginTop={1}>
            <Box gap={2} marginBottom={1}>
              <Label muted bold>
                {"   "}Status
              </Label>
              <Label muted bold>
                Name
              </Label>
            </Box>
            {displayPlugins.map((plugin, index) => {
              const isSelected = index === selectedIndex;
              const statusIcon = plugin.enabled ? "●" : "○";
              const statusColor = plugin.enabled ? "green" : "gray";

              return (
                <Box gap={2} key={plugin.name}>
                  <Label selected={isSelected}>{isSelected ? "▸" : " "}</Label>
                  <Text color={statusColor}>{statusIcon}</Text>
                  <Label selected={isSelected}>{plugin.enabled ? "ON " : "OFF"}</Label>
                  <Label selected={isSelected}>{plugin.name}</Label>
                  <Label muted>@{plugin.version}</Label>
                </Box>
              );
            })}
          </Box>
          {toggling && (
            <Box marginTop={1}>
              <Label selected>
                <Spinner type="dots" />
              </Label>
              <Label selected> Updating...</Label>
            </Box>
          )}
        </>
      )}
    </Layout>
  );
}
