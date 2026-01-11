import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { Dialog } from "../components/dialog.js";
import { Label } from "../components/label.js";
import { Layout } from "../components/layout.js";
import { Logo } from "../components/logo.js";
import { Menu, type MenuItem } from "../components/menu.js";
import { useTui } from "../context/tui-context.js";
import { deleteServer, updateServer } from "../lib/config-db.js";

interface ConnectionErrorScreenProps {
  error: string;
  errorType: string;
}

type State = "confirm_remove" | "list";

export function ConnectionErrorScreen({ error, errorType }: ConnectionErrorScreenProps) {
  const { clearConnection, connection, navigate, replace, resetNavigation, setConnection } =
    useTui();
  const [state, setState] = useState<State>("list");

  useInput((input, key) => {
    if (state !== "list") return;
    if (key.escape) {
      resetNavigation({ type: "select_server" });
    }
    if (input === "d" && connection?.serverId) {
      setState("confirm_remove");
    }
  });

  const handleSelect = (value: string) => {
    switch (value) {
      case "retry":
        replace({ type: "testing_connection" });
        break;
      case "skip_tls":
        if (connection) {
          // Update connection to skip TLS
          const newConnection = { ...connection, insecure: true };
          setConnection(newConnection);

          // Save preference if it's a saved server
          if (connection.serverId) {
            updateServer(connection.serverId, { insecure: true });
          }

          replace({ type: "testing_connection" });
        }
        break;
      case "change_url":
        navigate({
          type: "add_server",
          prefillName: connection?.name,
          prefillUrl: connection?.url,
        });
        break;
    }
  };

  const handleRemoveConfirm = (value: string) => {
    if (value === "confirm" && connection?.serverId) {
      deleteServer(connection.serverId);
      clearConnection();
      navigate({ type: "select_server" });
      return;
    }
    setState("list");
  };

  const isTlsError = errorType === "tls_error";

  const buildMenuItems = (): MenuItem[] => {
    if (isTlsError) {
      return [
        {
          description: "Connect without verifying certificate",
          label: "Yes, skip verification (insecure)",
          value: "skip_tls",
        },
        {
          description: "Use a different server",
          label: "Change server URL",
          value: "change_url",
        },
      ];
    }

    return [
      {
        description: "Try connecting again",
        label: "Retry connection",
        value: "retry",
      },
      {
        description: "Use a different server",
        label: "Change server URL",
        value: "change_url",
      },
    ];
  };

  const menuItems = buildMenuItems();

  if (state === "confirm_remove" && connection) {
    return (
      <Layout>
        <Box alignItems="center" flexDirection="column">
          <Dialog
            buttons={[
              { label: "Cancel", value: "cancel" },
              { label: "Remove", value: "confirm" },
            ]}
            message={`URL: ${connection.url}`}
            title="Remove Server"
            onSelect={handleRemoveConfirm}
          />
        </Box>
      </Layout>
    );
  }

  const shortcuts = connection?.serverId ? [{ action: "Delete", key: "d" }] : [];

  return (
    <Layout shortcuts={shortcuts}>
      <Logo />
      <Box marginBottom={1}>
        <Text color="red">{isTlsError ? "! TLS Certificate Error" : "x Connection Failed"}</Text>
      </Box>
      <Label wrap="wrap">
        {isTlsError
          ? `Could not verify the certificate for ${connection?.url}`
          : `Could not connect to ${connection?.url}`}
      </Label>
      {!isTlsError && (
        <Box marginTop={1}>
          <Label muted wrap="wrap">
            Error: {error}
          </Label>
        </Box>
      )}
      {isTlsError && (
        <Box flexDirection="column" marginTop={1}>
          <Label muted wrap="wrap">
            This usually happens with self-signed certificates. Do you want to skip TLS verification
            for this server?
          </Label>
        </Box>
      )}
      {!isTlsError && (
        <Box marginTop={1}>
          <Label muted wrap="wrap">
            Make sure the Buntime server is running and accessible.
          </Label>
        </Box>
      )}
      <Box marginTop={2}>
        <Menu items={menuItems} onSelect={handleSelect} />
      </Box>
    </Layout>
  );
}
