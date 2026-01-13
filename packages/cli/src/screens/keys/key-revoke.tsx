import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { useState } from "react";
import { Label } from "../../components/label.js";
import { Layout } from "../../components/layout.js";
import { Logo } from "../../components/logo.js";
import { TextInput } from "../../components/text-input.js";
import { useTui } from "../../context/tui-context.js";

interface KeyRevokeScreenProps {
  keyId: number;
  keyName: string;
}

export function KeyRevokeScreen({ keyId, keyName }: KeyRevokeScreenProps) {
  const { api, goBack, navigate } = useTui();
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useInput((_input, key) => {
    if (loading) return;

    if (key.escape) {
      if (success) {
        navigate({ type: "key_list" });
      } else {
        goBack();
      }
      return;
    }

    if (success && key.return) {
      navigate({ type: "key_list" });
      return;
    }

    if (key.return && confirmation.toLowerCase() === "revoke") {
      revokeKey();
    }
  });

  const revokeKey = async () => {
    if (!api) return;

    setLoading(true);
    setError(null);

    try {
      await api.revokeKey(keyId);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke key");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <Layout>
        <Logo />
        <Box flexDirection="column" alignItems="flex-start">
          <Text color="green" bold>
            KEY REVOKED
          </Text>
          <Box marginTop={1}>
            <Label>The API key "{keyName}" has been revoked.</Label>
          </Box>
          <Box marginTop={1}>
            <Label muted>Press Enter to continue</Label>
          </Box>
        </Box>
      </Layout>
    );
  }

  return (
    <Layout>
      <Logo />
      <Box flexDirection="column" alignItems="flex-start">
        <Text color="yellow" bold>
          REVOKE API KEY
        </Text>
        {error && (
          <Box marginTop={1}>
            <Text color="red">Error: {error}</Text>
          </Box>
        )}
        <Box marginTop={1} flexDirection="column">
          <Label>You are about to revoke the following key:</Label>
          <Box marginTop={1} flexDirection="column" marginLeft={2}>
            <Box>
              <Label muted>Name: </Label>
              <Label>{keyName}</Label>
            </Box>
            <Box>
              <Label muted>ID: </Label>
              <Label>{keyId}</Label>
            </Box>
          </Box>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color="red">This action cannot be undone.</Text>
          <Label muted>Any systems using this key will lose access immediately.</Label>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Label>Type "revoke" to confirm:</Label>
          <TextInput
            label="Confirmation"
            placeholder="revoke"
            value={confirmation}
            onChange={setConfirmation}
          />
        </Box>
        <Box marginTop={1}>
          {loading ? (
            <Box>
              <Text color="red">
                <Spinner type="dots" />
              </Text>
              <Label> Revoking key...</Label>
            </Box>
          ) : (
            <Label muted>Press Enter to confirm, Esc to cancel</Label>
          )}
        </Box>
      </Box>
    </Layout>
  );
}
