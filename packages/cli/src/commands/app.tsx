import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { useEffect, useState } from "react";
import { Table } from "../components/table.js";

interface AppInfo {
  name: string;
  path: string;
  versions: string[];
}

interface Props {
  options: {
    url: string;
  };
}

export default function AppList({ options }: Props) {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchApps() {
      try {
        const res = await fetch(`${options.url}/api/core/apps`);
        if (!res.ok) {
          throw new Error(`Failed to fetch apps: ${res.status} ${res.statusText}`);
        }
        const data = (await res.json()) as AppInfo[];
        setApps(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    fetchApps();
  }, [options.url]);

  if (loading) {
    return (
      <Box>
        <Text color="green">
          <Spinner type="dots" />
        </Text>
        <Text> Loading apps...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">Error: {error}</Text>
        <Text color="gray">Make sure buntime is running at {options.url}</Text>
      </Box>
    );
  }

  if (apps.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="cyan">No apps installed</Text>
        <Text color="gray">Use `buntime app install &lt;file.tgz&gt;` to install an app</Text>
      </Box>
    );
  }

  const tableData = apps.map((a) => ({
    Name: a.name,
    Versions: a.versions.join(", "),
    Path: a.path,
  }));

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        Installed Apps ({apps.length})
      </Text>
      <Box marginTop={1}>
        <Table data={tableData} />
      </Box>
    </Box>
  );
}
