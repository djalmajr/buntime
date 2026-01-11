import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { Button } from "../../components/button.js";
import { Label } from "../../components/label.js";
import { Layout } from "../../components/layout.js";
import { Logo } from "../../components/logo.js";
import { TextInput } from "../../components/text-input.js";
import { useTui } from "../../context/tui-context.js";
import { getServerById, updateServer } from "../../lib/config-db.js";

type Field = "btn_cancel" | "btn_save" | "insecure" | "name" | "token" | "url";

interface SettingsEditScreenProps {
  serverId: number;
}

export function SettingsEditScreen({ serverId }: SettingsEditScreenProps) {
  const { goBack } = useTui();
  const server = getServerById(serverId);

  const [name, setName] = useState(server?.name ?? "");
  const [url, setUrl] = useState(server?.url ?? "");
  const [token, setToken] = useState(server?.token ?? "");
  const [insecure, setInsecure] = useState(server?.insecure ?? false);
  const [focusedField, setFocusedField] = useState<Field>("name");
  const [error, setError] = useState<string | null>(null);

  const fields: Field[] = ["name", "url", "token", "insecure", "btn_cancel", "btn_save"];

  useInput((input, key) => {
    if (key.escape) {
      goBack();
      return;
    }

    // Tab navigation (forward and backward)
    if (key.tab) {
      const currentIndex = fields.indexOf(focusedField);
      const nextIndex = key.shift
        ? (currentIndex - 1 + fields.length) % fields.length
        : (currentIndex + 1) % fields.length;
      setFocusedField(fields[nextIndex]!);
      return;
    }

    // Toggle checkbox with space when on insecure field
    if (input === " " && focusedField === "insecure") {
      setInsecure((prev) => !prev);
      return;
    }

    // Arrow key navigation between buttons
    if (focusedField === "btn_cancel" || focusedField === "btn_save") {
      if (key.leftArrow || key.rightArrow) {
        setFocusedField(focusedField === "btn_cancel" ? "btn_save" : "btn_cancel");
        return;
      }
    }

    if (key.return) {
      if (focusedField === "btn_cancel") {
        goBack();
      } else if (focusedField === "btn_save") {
        handleSave();
      } else if (focusedField === "insecure") {
        setInsecure((prev) => !prev);
      } else {
        // On input fields, submit the form
        handleSave();
      }
    }
  });

  const handleSave = () => {
    if (!name.trim()) {
      setError("Server name is required");
      return;
    }

    if (!url.trim()) {
      setError("Server URL is required");
      return;
    }

    try {
      new URL(url);
    } catch {
      setError("Invalid URL format");
      return;
    }

    updateServer(serverId, {
      insecure,
      name: name.trim(),
      token: token.trim() || null,
      url: url.trim(),
    });

    goBack();
  };

  if (!server) {
    return (
      <Layout>
        <Logo />
        <Text color="red">Server not found</Text>
      </Layout>
    );
  }

  return (
    <Layout>
      <Logo />
      <Label bold>Edit Server</Label>
      <Box flexDirection="column" gap={1} marginTop={1}>
        <TextInput
          focused={focusedField === "name"}
          label="Name"
          onChange={setName}
          value={name}
          width={50}
        />
        <TextInput
          focused={focusedField === "url"}
          label="URL"
          onChange={setUrl}
          value={url}
          width={50}
        />
        <TextInput
          focused={focusedField === "token"}
          label="Auth Token (optional)"
          mask
          onChange={setToken}
          value={token}
          width={50}
        />
        <Box marginTop={1}>
          <Label selected={focusedField === "insecure"}>
            [{insecure ? "x" : " "}] Skip TLS verification (insecure)
          </Label>
        </Box>
        {error && (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}
        <Box gap={2} justifyContent="flex-end" marginTop={2}>
          <Button focused={focusedField === "btn_cancel"} label="Cancel" type="cancel" />
          <Button focused={focusedField === "btn_save"} label="Save" type="submit" />
        </Box>
      </Box>
    </Layout>
  );
}
