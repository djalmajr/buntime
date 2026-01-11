import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { Button } from "../components/button.js";
import { Label } from "../components/label.js";
import { Layout } from "../components/layout.js";
import { Logo } from "../components/logo.js";
import { TextInput } from "../components/text-input.js";
import { useTui } from "../context/tui-context.js";
import { addServer, getServerByUrl } from "../lib/config-db.js";
import { connectionFromServer } from "../lib/connection.js";

type Field = "btn_add" | "btn_cancel" | "name" | "url";

export function AddServerScreen() {
  const { currentScreen, goBack, navigate, setConnection } = useTui();

  // Use prefill values if provided (e.g., coming from connection-error), otherwise empty
  const prefillUrl = currentScreen.type === "add_server" ? currentScreen.prefillUrl : undefined;
  const prefillName = currentScreen.type === "add_server" ? currentScreen.prefillName : undefined;

  const [name, setName] = useState(prefillName ?? "");
  const [url, setUrl] = useState(prefillUrl ?? "");
  const [focusedField, setFocusedField] = useState<Field>("name");
  const [error, setError] = useState<string | null>(null);

  const fields: Field[] = ["name", "url", "btn_cancel", "btn_add"];

  useInput((_input, key) => {
    if (key.escape) {
      goBack();
      return;
    }

    // Tab navigation
    if (key.tab) {
      const currentIndex = fields.indexOf(focusedField);
      const nextIndex = key.shift
        ? (currentIndex - 1 + fields.length) % fields.length
        : (currentIndex + 1) % fields.length;
      setFocusedField(fields[nextIndex]!);
      return;
    }

    // Arrow key navigation between buttons
    if (focusedField === "btn_cancel" || focusedField === "btn_add") {
      if (key.leftArrow || key.rightArrow) {
        setFocusedField(focusedField === "btn_cancel" ? "btn_add" : "btn_cancel");
        return;
      }
    }

    // Enter handling
    if (key.return) {
      if (focusedField === "btn_cancel") {
        goBack();
      } else if (focusedField === "btn_add") {
        handleSubmit();
      } else {
        // On input fields, submit the form
        handleSubmit();
      }
    }
  });

  const handleSubmit = () => {
    if (!url.trim()) {
      setError("Server URL is required");
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      setError("Invalid URL format");
      return;
    }

    // Check if URL already exists
    const existing = getServerByUrl(url);
    if (existing) {
      setError("A server with this URL already exists");
      return;
    }

    // Auto-generate name from URL if not provided
    const serverName = name.trim() || parsedUrl.hostname;

    // Add the server
    const server = addServer({ name: serverName, url: url.trim() });
    setConnection(connectionFromServer(server));
    navigate({ type: "testing_connection" });
  };

  return (
    <Layout>
      <Logo />
      <Label bold>Add Server</Label>
      <Box flexDirection="column" gap={1} marginTop={1}>
        <TextInput
          focused={focusedField === "name"}
          label="Server name (alias):"
          onChange={setName}
          placeholder="Local Dev"
          value={name}
          width={50}
        />
        <TextInput
          focused={focusedField === "url"}
          label="Server URL:"
          onChange={setUrl}
          placeholder="http://localhost:8000"
          value={url}
          width={50}
        />
        {error && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          <Label muted>Examples:</Label>
          <Label muted> - http://localhost:8000 (local development)</Label>
          <Label muted> - https://buntime.home (home server)</Label>
        </Box>
        <Box gap={2} justifyContent="flex-end" marginTop={2}>
          <Button focused={focusedField === "btn_cancel"} label="Cancel" type="cancel" />
          <Button focused={focusedField === "btn_add"} label="Add" type="submit" />
        </Box>
      </Box>
    </Layout>
  );
}
