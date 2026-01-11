import { Box, useInput } from "ink";
import { useEffect, useState } from "react";
import { Dialog } from "../components/dialog.js";
import { Label } from "../components/label.js";
import { Layout } from "../components/layout.js";
import { Logo } from "../components/logo.js";
import { ScrollableList } from "../components/scrollable-list.js";
import { useTui } from "../context/tui-context.js";
import { deleteServer, getServers, resetAll, type ServerConfig } from "../lib/config-db.js";
import { connectionFromServer } from "../lib/connection.js";

type State = "confirm_remove" | "confirm_reset" | "list";

export function ServerSelectionScreen() {
  const { clearConnection, currentState, navigate, setConnection, updateScreenState } = useTui();
  const [servers, setServers] = useState<ServerConfig[]>(getServers);
  const [selectedIndex, setSelectedIndex] = useState(currentState?.selectedIndex ?? 0);
  const [state, setState] = useState<State>("list");

  const totalItems = servers.length;

  // Save selection state for navigation back
  useEffect(() => {
    updateScreenState({ selectedIndex });
  }, [selectedIndex, updateScreenState]);

  useInput((input, key) => {
    if (state !== "list") {
      if (key.escape) {
        setState("list");
      }
      return;
    }

    if (key.upArrow || input === "k") {
      if (totalItems > 0) {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      }
    } else if (key.downArrow || input === "j") {
      if (totalItems > 0) {
        setSelectedIndex((prev) => Math.min(totalItems - 1, prev + 1));
      }
    } else if (key.return) {
      const server = servers[selectedIndex];
      if (server) {
        setConnection(connectionFromServer(server));
        navigate({ type: "testing_connection" });
      }
    } else if (input === "a") {
      navigate({ type: "add_server" });
    } else if (input === "e" && servers.length > 0) {
      const server = servers[selectedIndex];
      if (server) {
        navigate({ serverId: server.id, type: "settings_edit" });
      }
    } else if (input === "d" && servers.length > 0) {
      setState("confirm_remove");
    } else if (input === "r" && servers.length > 0) {
      setState("confirm_reset");
    }
  });

  const handleRemoveConfirm = (value: string) => {
    if (value === "confirm") {
      const server = servers[selectedIndex];
      if (server) {
        deleteServer(server.id);
        const newServers = getServers();
        setServers(newServers);
        if (selectedIndex >= newServers.length && selectedIndex > 0) {
          setSelectedIndex(selectedIndex - 1);
        }
      }
    }
    setState("list");
  };

  const handleResetConfirm = (value: string) => {
    if (value === "confirm") {
      clearConnection();
      resetAll();
      setServers([]);
      setSelectedIndex(0);
    }
    setState("list");
  };

  const selectedServer = servers[selectedIndex];

  if (state === "confirm_remove" && selectedServer) {
    return (
      <Layout>
        <Box alignItems="center" flexDirection="column">
          <Dialog
            buttons={[
              { label: "Cancel", value: "cancel" },
              { label: "Remove", value: "confirm" },
            ]}
            message={`Name: ${selectedServer.name}\nURL: ${selectedServer.url}`}
            title="Remove Server"
            onSelect={handleRemoveConfirm}
          />
        </Box>
      </Layout>
    );
  }

  if (state === "confirm_reset") {
    return (
      <Layout>
        <Box alignItems="center" flexDirection="column">
          <Dialog
            buttons={[
              { label: "Cancel", value: "cancel" },
              { label: "Reset", value: "confirm" },
            ]}
            message={`This will delete all saved data:\n  - All saved servers (${servers.length})\n  - Auth tokens\n  - Global preferences\n\nYou will need to add a server again.`}
            title="Reset All Data"
            onSelect={handleResetConfirm}
          />
        </Box>
      </Layout>
    );
  }

  const shortcuts = [
    { action: "Add", key: "a" },
    ...(servers.length > 0
      ? [
          { action: "Edit", key: "e" },
          { action: "Delete", key: "d" },
          { action: "Reset all", key: "r" },
        ]
      : []),
  ];

  const renderServerItem = (server: ServerConfig, _index: number, isSelected: boolean) => {
    // If name equals URL or is a generic name, just show URL as primary
    const isGenericName = server.name === server.url || server.name === "Server";
    const hasCustomName = !isGenericName && server.name.trim().length > 0;

    if (hasCustomName) {
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Label selected={isSelected}>
            {isSelected ? "●" : "○"} {server.name}
          </Label>
          <Box marginLeft={2}>
            <Label muted>{server.url}</Label>
          </Box>
        </Box>
      );
    }

    // Show only URL as primary text
    return (
      <Box marginBottom={1}>
        <Label selected={isSelected}>
          {isSelected ? "●" : "○"} {server.url}
        </Label>
      </Box>
    );
  };

  return (
    <Layout shortcuts={shortcuts}>
      <Logo />
      <Label bold>Servers</Label>
      {servers.length === 0 ? (
        <Box marginTop={1}>
          <Label muted>No servers configured. Press 'a' to add one.</Label>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <ScrollableList
            itemHeight={2}
            items={servers}
            maxVisibleItems={5}
            renderItem={renderServerItem}
            reservedHeight={12}
            selectedIndex={selectedIndex}
          />
        </Box>
      )}
    </Layout>
  );
}
