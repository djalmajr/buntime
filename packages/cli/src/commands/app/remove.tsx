import { Box, Text, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import { useEffect, useState } from "react";
import { z } from "zod";

export const description = "Remove an installed app";

export const options = z.object({
  force: z.boolean().default(false).describe("Skip confirmation prompt"),
  token: z.string().optional().describe("Authentication token"),
  url: z.string().default("http://localhost:8000").describe("Buntime server URL"),
});

interface AppInfo {
  name: string;
  path: string;
  versions: string[];
}

type Status = "confirming" | "done" | "error" | "loading" | "removing" | "selecting";

interface Props {
  options: z.infer<typeof options>;
}

export default function AppRemove({ options }: Props) {
  const { exit } = useApp();
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [selected, setSelected] = useState<AppInfo | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  // Fetch apps on mount
  useEffect(() => {
    async function fetchApps() {
      try {
        const res = await fetch(`${options.url}/api/core/apps`);
        if (!res.ok) {
          throw new Error(`Failed to fetch apps: ${res.status}`);
        }
        const data = (await res.json()) as AppInfo[];
        if (data.length === 0) {
          setError("No apps installed");
          setStatus("error");
          return;
        }
        setApps(data);
        setStatus("selecting");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setStatus("error");
      }
    }
    fetchApps();
  }, [options.url]);

  // Handle confirmation input
  useInput(
    (input, key) => {
      if (status !== "confirming") return;

      if (input.toLowerCase() === "y") {
        doRemove();
      } else if (input.toLowerCase() === "n" || key.escape) {
        exit();
      }
    },
    { isActive: status === "confirming" },
  );

  async function doRemove() {
    if (!selected) return;

    setStatus("removing");

    try {
      const headers: Record<string, string> = {};
      if (options.token) {
        headers.Authorization = `Bearer ${options.token}`;
      }

      // Build URL path: @scope/name or @scope/name/version
      const nameParts = selected.name.split("/");
      let path: string;
      if (selectedVersion) {
        path = `${nameParts.join("/")}/${selectedVersion}`;
      } else {
        path = nameParts.join("/");
      }

      const res = await fetch(`${options.url}/api/core/apps/${path}`, {
        headers,
        method: "DELETE",
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Delete failed: ${res.status} - ${text}`);
      }

      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }

  function handleSelectApp(item: { label: string; value: AppInfo }) {
    setSelected(item.value);
    if (item.value.versions.length === 1) {
      // Only one version, select it automatically
      setSelectedVersion(item.value.versions[0] ?? null);
      if (options.force) {
        doRemove();
      } else {
        setStatus("confirming");
      }
    } else {
      // Multiple versions, show version selector
      setStatus("selecting");
    }
  }

  // Loading state
  if (status === "loading") {
    return (
      <Box>
        <Text color="green">
          <Spinner type="dots" />
        </Text>
        <Text> Loading apps...</Text>
      </Box>
    );
  }

  // Error state
  if (status === "error") {
    return (
      <Box flexDirection="column">
        <Text color="red">Error: {error}</Text>
        <Text color="gray">Make sure buntime is running at {options.url}</Text>
      </Box>
    );
  }

  // App selection
  if (status === "selecting" && !selected) {
    const items = apps.map((a) => ({
      label: `${a.name} (${a.versions.length} version${a.versions.length > 1 ? "s" : ""})`,
      value: a,
    }));

    return (
      <Box flexDirection="column">
        <Text bold>Select an app to remove:</Text>
        <SelectInput items={items} onSelect={handleSelectApp} />
        <Box marginTop={1}>
          <Text color="gray">Press Escape to cancel</Text>
        </Box>
      </Box>
    );
  }

  // Version selection
  if (status === "selecting" && selected && selected.versions.length > 1 && !selectedVersion) {
    const items = [
      { label: "All versions", value: "__all__" },
      ...selected.versions.map((v) => ({ label: v, value: v })),
    ];

    return (
      <Box flexDirection="column">
        <Text bold>Select version to remove for {selected.name}:</Text>
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.value === "__all__") {
              setSelectedVersion(null);
            } else {
              setSelectedVersion(item.value);
            }
            if (options.force) {
              doRemove();
            } else {
              setStatus("confirming");
            }
          }}
        />
        <Box marginTop={1}>
          <Text color="gray">Press Escape to cancel</Text>
        </Box>
      </Box>
    );
  }

  // Confirmation
  if (status === "confirming") {
    const target = selectedVersion
      ? `${selected?.name}@${selectedVersion}`
      : `${selected?.name} (all versions)`;

    return (
      <Box flexDirection="column">
        <Text color="cyan">Are you sure you want to remove {target}?</Text>
        <Text color="gray">Press Y to confirm, N or Escape to cancel</Text>
      </Box>
    );
  }

  // Removing
  if (status === "removing") {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text color="cyan"> Removing app...</Text>
      </Box>
    );
  }

  // Done
  if (status === "done") {
    const target = selectedVersion
      ? `${selected?.name}@${selectedVersion}`
      : `${selected?.name} (all versions)`;

    return (
      <Box>
        <Text color="green">App removed: {target}</Text>
      </Box>
    );
  }

  return null;
}
