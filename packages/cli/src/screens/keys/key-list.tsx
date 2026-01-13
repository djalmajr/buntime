import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { useEffect, useState } from "react";
import { Label } from "../../components/label.js";
import { Layout } from "../../components/layout.js";
import { Logo } from "../../components/logo.js";
import { useTui } from "../../context/tui-context.js";
import type { ApiKeyInfo } from "../../lib/api-client.js";

function formatDate(timestamp: number | null): string {
  if (!timestamp) return "never";
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} mins ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} days ago`;

  return date.toLocaleDateString();
}

export function KeyListScreen() {
  const { api, currentState, goBack, navigate, updateScreenState } = useTui();
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(currentState?.selectedIndex ?? 0);

  useEffect(() => {
    updateScreenState({ selectedIndex });
  }, [selectedIndex, updateScreenState]);

  useInput((input, key) => {
    if (key.escape) {
      goBack();
      return;
    }
    if (input === "r") {
      fetchKeys();
      return;
    }
    if (input === "n") {
      navigate({ type: "key_create" });
      return;
    }
    if (input === "d" && keys.length > 0) {
      const selectedKey = keys[selectedIndex];
      if (selectedKey) {
        navigate({ keyId: selectedKey.id, keyName: selectedKey.name, type: "key_revoke" });
      }
      return;
    }
    if (key.upArrow || input === "k") {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((prev) => Math.min(keys.length - 1, prev + 1));
      return;
    }
  });

  const fetchKeys = async () => {
    if (!api) return;

    setLoading(true);
    setError(null);

    try {
      const data = await api.listKeys();
      setKeys(data);
      setSelectedIndex((prev) => Math.min(prev, Math.max(0, data.length - 1)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, [api]);

  const shortcuts = [
    { action: "New", key: "n" },
    ...(keys.length > 0 ? [{ action: "Revoke", key: "d" }] : []),
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
          <Label> Loading API keys...</Label>
        </Box>
      )}
      {error && (
        <Box flexDirection="column">
          <Text color="red">Error: {error}</Text>
          <Label muted>Press 'r' to retry</Label>
        </Box>
      )}
      {!loading && !error && keys.length === 0 && (
        <Box alignItems="flex-start" flexDirection="column" marginTop={1}>
          <Label>No API keys created yet.</Label>
          <Box marginTop={1}>
            <Label muted>Press 'n' to create your first API key</Label>
          </Box>
        </Box>
      )}
      {!loading && !error && keys.length > 0 && (
        <>
          <Label selected bold>
            API Keys ({keys.length})
          </Label>
          <Box flexDirection="column" marginTop={1}>
            <Box gap={2} marginBottom={1}>
              <Label muted bold>
                {"   "}Name
              </Label>
              <Label muted bold>
                Role
              </Label>
              <Label muted bold>
                Prefix
              </Label>
              <Label muted bold>
                Last Used
              </Label>
            </Box>
            {keys.map((key, index) => {
              const isSelected = index === selectedIndex;

              return (
                <Box gap={2} key={key.id}>
                  <Label selected={isSelected}>{isSelected ? ">" : " "}</Label>
                  <Label selected={isSelected}>{key.name.padEnd(16)}</Label>
                  <Label muted={!isSelected}>{key.role.padEnd(8)}</Label>
                  <Label muted>{key.keyPrefix}...</Label>
                  <Label muted>{formatDate(key.lastUsedAt)}</Label>
                </Box>
              );
            })}
          </Box>
        </>
      )}
    </Layout>
  );
}
