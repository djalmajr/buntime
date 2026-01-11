import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { Label } from "../components/label.js";
import { Layout } from "../components/layout.js";
import { Logo } from "../components/logo.js";
import { TextInput } from "../components/text-input.js";
import { useTui } from "../context/tui-context.js";
import { ApiClient, ApiError } from "../lib/api-client.js";
import { setLastServerId, touchServer, updateServer } from "../lib/config-db.js";

interface TokenPromptScreenProps {
  message?: string;
}

export function TokenPromptScreen({ message }: TokenPromptScreenProps) {
  const { connection, goBack, navigate, setApi, setConnection } = useTui();
  const [token, setToken] = useState("");
  const [saveToken, setSaveToken] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useInput((input, key) => {
    if (key.escape) {
      goBack();
      return;
    }

    if (input === " " && !loading) {
      setSaveToken((prev) => !prev);
      return;
    }
  });

  const handleSubmit = async () => {
    if (!token.trim()) {
      setError("Token is required");
      return;
    }

    if (!connection) {
      goBack();
      return;
    }

    setLoading(true);
    setError(null);

    const client = new ApiClient({
      insecure: connection.insecure,
      token: token.trim(),
      url: connection.url,
    });

    try {
      await client.testConnection();

      // Save token if requested
      if (saveToken && connection.serverId) {
        updateServer(connection.serverId, { token: token.trim() });
        touchServer(connection.serverId);
        setLastServerId(connection.serverId);
      }

      // Update connection with token
      setConnection({ ...connection, token: token.trim() });
      setApi(client);
      navigate({ type: "main_menu" });
    } catch (err) {
      setLoading(false);

      if (err instanceof ApiError) {
        if (err.type === "auth_required") {
          setError("Invalid token. Please try again.");
          return;
        }
        setError(err.message);
        return;
      }

      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  return (
    <Layout shortcuts={[{ action: "Toggle save", key: "Space" }]}>
      <Logo />
      <Box marginBottom={1}>
        <Label selected>! Authentication Required</Label>
      </Box>
      <Label>The server requires authentication.</Label>
      {message && (
        <Box marginTop={1}>
          <Label muted>{message}</Label>
        </Box>
      )}
      <Box marginTop={2}>
        <TextInput
          focused={!loading}
          label="Enter authentication token:"
          mask
          onChange={setToken}
          onSubmit={handleSubmit}
          value={token}
          width={50}
        />
      </Box>
      <Box marginTop={1}>
        <Label>
          <Label selected={saveToken} muted={!saveToken}>
            [{saveToken ? "x" : " "}]
          </Label>{" "}
          Save token for this server
        </Label>
      </Box>
      {error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}
      <Box marginTop={2}>
        <Label muted>Tip: You can also set BUNTIME_TOKEN environment variable.</Label>
      </Box>
    </Layout>
  );
}
