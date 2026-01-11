import { existsSync, statSync } from "node:fs";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { useState } from "react";
import { Flex } from "../../components/flex.js";
import { Label } from "../../components/label.js";
import { Layout } from "../../components/layout.js";
import { Logo } from "../../components/logo.js";
import { TextInput } from "../../components/text-input.js";
import { useTui } from "../../context/tui-context.js";
import type { InstallResult } from "../../lib/api-client.js";

type State = "error" | "input" | "packing" | "success" | "uploading";

export function PluginInstallScreen() {
  const { api, goBack } = useTui();
  const [filePath, setFilePath] = useState("");
  const [state, setState] = useState<State>("input");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InstallResult | null>(null);

  useInput((input, key) => {
    if (key.escape) {
      if (state === "success" || state === "error") {
        goBack();
      } else if (state === "input") {
        goBack();
      }
      return;
    }

    if (state === "success") {
      if (key.return) {
        goBack();
        return;
      }
      if (input === "i") {
        setState("input");
        setFilePath("");
        setResult(null);
        return;
      }
    }

    if (state === "error") {
      if (input === "r") {
        handleInstall();
        return;
      }
      if (key.return) {
        setState("input");
        setError(null);
        return;
      }
    }
  });

  const handleInstall = async () => {
    if (!api) return;

    const path = filePath.trim();
    if (!path) {
      setError("Please enter a file path");
      setState("error");
      return;
    }

    // Resolve path
    const resolvedPath = path.startsWith("/") ? path : `${process.cwd()}/${path}`;

    if (!existsSync(resolvedPath)) {
      setError(`File not found: ${resolvedPath}`);
      setState("error");
      return;
    }

    const stats = statSync(resolvedPath);
    const isDirectory = stats.isDirectory();

    if (isDirectory) {
      // TODO: Pack directory to tarball
      setState("packing");
      setError("Directory packing not yet implemented. Please use a tarball.");
      setState("error");
      return;
    }

    // Check file extension
    const ext = path.split(".").pop()?.toLowerCase();
    if (ext !== "tgz" && ext !== "zip" && ext !== "gz") {
      setError("Unsupported file type. Use .tgz, .tar.gz, or .zip");
      setState("error");
      return;
    }

    setState("uploading");

    try {
      const fileContent = await Bun.file(resolvedPath).arrayBuffer();
      const fileName = resolvedPath.split("/").pop() ?? "plugin.tgz";
      const file = new File([fileContent], fileName);

      const installResult = await api.installPlugin(file);
      setResult(installResult);
      setState("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  };

  const handleSubmit = () => {
    handleInstall();
  };

  const shortcuts: Partial<Record<State, { action: string; key: string }[]>> = {
    error: [{ action: "Retry", key: "r" }],
    success: [{ action: "Install another", key: "i" }],
  };

  return (
    <Layout shortcuts={shortcuts[state] ?? []}>
      <Logo />
      <Label bold>Install Plugin</Label>

      {state === "input" && (
        <Box flexDirection="column" marginTop={1}>
          <TextInput
            focused
            label="Enter path to plugin (tarball, zip, or directory):"
            onChange={setFilePath}
            onSubmit={handleSubmit}
            placeholder="./my-plugin.tgz"
            value={filePath}
          />

          <Box marginTop={1}>
            <Label muted>Supported: .tgz, .zip, or directory</Label>
          </Box>
        </Box>
      )}

      {state === "packing" && (
        <Box alignItems="center" flexGrow={1} justifyContent="center">
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Label> Creating tarball...</Label>
        </Box>
      )}

      {state === "uploading" && (
        <Box alignItems="center" flexGrow={1} justifyContent="center">
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Label> Uploading and extracting...</Label>
        </Box>
      )}

      {state === "success" && result && (
        <Box alignItems="center" flexDirection="column" flexGrow={1}>
          <Box marginTop={2}>
            <Text color="green">+ Plugin installed successfully!</Text>
          </Box>

          <Flex bordered flexDirection="column" marginTop={2} paddingX={2} paddingY={1}>
            <Label>
              Name: <Label selected>{result.name}</Label>
            </Label>
            <Label>
              Version: <Label selected>{result.version}</Label>
            </Label>
            <Label>
              Path: <Label muted>{result.path}</Label>
            </Label>
          </Flex>
        </Box>
      )}

      {state === "error" && (
        <Box alignItems="center" flexDirection="column" flexGrow={1}>
          <Box marginTop={2}>
            <Text color="red">x Installation failed</Text>
          </Box>

          <Flex
            bordered
            borderColor="red"
            flexDirection="column"
            marginTop={2}
            paddingX={2}
            paddingY={1}
          >
            <Text color="red">{error}</Text>
          </Flex>
        </Box>
      )}
    </Layout>
  );
}
