import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { useEffect, useState } from "react";
import { z } from "zod";

export const description = "Install an app from a tarball (.tgz)";

export const args = z.tuple([z.string().describe("Path to the app tarball (.tgz)")]);

export const options = z.object({
  token: z.string().optional().describe("Authentication token"),
  url: z.string().default("http://localhost:8000").describe("Buntime server URL"),
});

type Status = "done" | "error" | "uploading";

interface InstallResult {
  data?: {
    app: {
      installedAt: string;
      name: string;
      version: string;
    };
  };
  success: boolean;
}

interface Props {
  args: z.infer<typeof args>;
  options: z.infer<typeof options>;
}

export default function AppInstall({ args, options }: Props) {
  const [file] = args;
  const [status, setStatus] = useState<Status>("uploading");
  const [result, setResult] = useState<InstallResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function upload() {
      try {
        // Check if file exists
        const bunFile = Bun.file(file);
        if (!(await bunFile.exists())) {
          throw new Error(`File not found: ${file}`);
        }

        // Check file extension
        if (!file.endsWith(".tgz") && !file.endsWith(".tar.gz")) {
          throw new Error("File must be a .tgz or .tar.gz archive");
        }

        const form = new FormData();
        form.append("file", bunFile);

        const headers: Record<string, string> = {};
        if (options.token) {
          headers.Authorization = `Bearer ${options.token}`;
        }

        const res = await fetch(`${options.url}/api/core/apps/upload`, {
          body: form,
          headers,
          method: "POST",
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Upload failed: ${res.status} - ${text}`);
        }

        const data = (await res.json()) as InstallResult;
        setResult(data);
        setStatus("done");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setStatus("error");
      }
    }
    upload();
  }, [file, options.token, options.url]);

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Installing app: {file}</Text>

      {status === "uploading" && (
        <Box>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text color="cyan"> Uploading and extracting...</Text>
        </Box>
      )}

      {status === "done" && result?.data && (
        <Box flexDirection="column">
          <Text color="green">App installed successfully!</Text>
          <Box marginLeft={2} flexDirection="column">
            <Text>
              Name: <Text bold>{result.data.app.name}</Text>
            </Text>
            <Text>
              Version: <Text bold>{result.data.app.version}</Text>
            </Text>
            <Text>
              Path: <Text color="gray">{result.data.app.installedAt}</Text>
            </Text>
          </Box>
        </Box>
      )}

      {status === "error" && (
        <Box flexDirection="column">
          <Text color="red">Error: {error}</Text>
          <Text color="gray">Make sure buntime is running at {options.url}</Text>
        </Box>
      )}
    </Box>
  );
}
