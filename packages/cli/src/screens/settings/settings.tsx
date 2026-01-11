import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import { Dialog } from "../../components/dialog.js";
import { Label } from "../../components/label.js";
import { Layout } from "../../components/layout.js";
import { Logo } from "../../components/logo.js";
import { useTui } from "../../context/tui-context.js";
import { deleteServer, getServers, resetAll, type ServerConfig } from "../../lib/config-db.js";
import { connectionFromServer } from "../../lib/connection.js";

type State = "confirm_remove" | "confirm_reset" | "list";

export function SettingsScreen() {
  const {
    clearConnection,
    connection,
    currentState,
    goBack,
    navigate,
    replace,
    resetNavigation,
    setConnection,
    updateScreenState,
  } = useTui();
  const [servers, setServers] = useState<ServerConfig[]>(getServers);
  const [selectedIndex, setSelectedIndex] = useState(currentState?.selectedIndex ?? 0);
  const [state, setState] = useState<State>("list");

  // Save selection state for navigation back
  useEffect(() => {
    updateScreenState({ selectedIndex });
  }, [selectedIndex, updateScreenState]);

  useInput((input, key) => {
    if (key.escape) {
      if (state !== "list") {
        setState("list");
      } else {
        goBack();
      }
      return;
    }

    if (state === "list") {
      const len = servers.length;
      if (key.upArrow || input === "k") {
        setSelectedIndex((prev) => (prev - 1 + len) % len);
      } else if (key.downArrow || input === "j") {
        setSelectedIndex((prev) => (prev + 1) % len);
      } else if (key.return && selectedIndex < servers.length) {
        // Connect to selected server
        const server = servers[selectedIndex];
        if (server) {
          setConnection(connectionFromServer(server));
          replace({ type: "testing_connection" });
        }
      } else if (input === "a") {
        navigate({ type: "add_server" });
      } else if (input === "e" && selectedIndex < servers.length) {
        const server = servers[selectedIndex];
        if (server) {
          navigate({ serverId: server.id, type: "settings_edit" });
        }
      } else if (input === "d" && selectedIndex < servers.length) {
        setState("confirm_remove");
      } else if (input === "r") {
        setState("confirm_reset");
      }
    }
  });

  const handleRemoveConfirm = (value: string) => {
    if (value === "confirm") {
      const server = servers[selectedIndex];
      if (server) {
        // Clear connection if removing active server
        if (connection?.serverId === server.id) {
          clearConnection();
        }

        deleteServer(server.id);
        const updatedServers = getServers();
        setServers(updatedServers);

        // Navigate to add_server if no servers left
        if (updatedServers.length === 0) {
          resetNavigation({ type: "add_server" });
          return;
        }

        // Adjust selected index if needed
        if (selectedIndex >= updatedServers.length && selectedIndex > 0) {
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
      // Go directly to add_server with clean navigation stack
      resetNavigation({ type: "add_server" });
    } else {
      setState("list");
    }
  };

  const selectedServer = servers[selectedIndex];

  const shortcuts: Partial<Record<State, { action: string; key: string }[]>> = {
    list: [
      { action: "Add server", key: "a" },
      { action: "Edit server", key: "e" },
      { action: "Delete server", key: "d" },
      { action: "Reset all", key: "r" },
    ],
  };

  return (
    <Layout shortcuts={shortcuts[state] ?? []}>
      <Logo />
      {state === "list" && (
        <>
          <Label bold>Saved Servers</Label>
          <Box flexDirection="column" marginTop={1}>
            {servers.length === 0 ? (
              <Label muted>No servers saved</Label>
            ) : (
              servers.map((server, index) => {
                const isActive = connection?.serverId === server.id;
                const isSelected = index === selectedIndex;

                return (
                  <Box flexDirection="column" key={server.id} marginBottom={1}>
                    <Label selected={isSelected}>
                      {isSelected ? "▸" : " "} {isActive ? <Text color="green">●</Text> : "○"}{" "}
                      {server.name}
                    </Label>
                    <Box marginLeft={2}>
                      <Label muted>{server.url}</Label>
                    </Box>
                  </Box>
                );
              })
            )}
          </Box>
        </>
      )}

      {state === "confirm_remove" && selectedServer && (
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
      )}

      {state === "confirm_reset" && (
        <Box alignItems="center" flexDirection="column">
          <Dialog
            buttons={[
              { label: "Cancel", value: "cancel" },
              { label: "Reset", value: "confirm" },
            ]}
            message={`This will delete all saved data:\n  - All saved servers (${servers.length} servers)\n  - Auth tokens\n  - Global preferences\n\nYou will need to add a server again.`}
            title="Reset All Data"
            onSelect={handleResetConfirm}
          />
        </Box>
      )}
    </Layout>
  );
}
