import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { useEffect, useState } from "react";
import { Table } from "../components/table.js";

interface PluginInfo {
  base?: string;
  name: string;
  path: string;
  versions: string[];
}

interface Props {
  options: {
    url: string;
  };
}

export default function PluginList({ options }: Props) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPlugins() {
      try {
        const res = await fetch(`${options.url}/api/core/plugins`);
        if (!res.ok) {
          throw new Error(`Failed to fetch plugins: ${res.status} ${res.statusText}`);
        }
        const data = (await res.json()) as PluginInfo[];
        setPlugins(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    fetchPlugins();
  }, [options.url]);

  if (loading) {
    return (
      <Box>
        <Text color="green">
          <Spinner type="dots" />
        </Text>
        <Text> Loading plugins...</Text>
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

  if (plugins.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="cyan">No plugins installed</Text>
        <Text color="gray">Use `buntime plugin install &lt;file.tgz&gt;` to install a plugin</Text>
      </Box>
    );
  }

  const tableData = plugins.map((p) => ({
    Name: p.name,
    Base: p.base ?? "-",
    Versions: p.versions.join(", "),
  }));

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        Installed Plugins ({plugins.length})
      </Text>
      <Box marginTop={1}>
        <Table data={tableData} />
      </Box>
    </Box>
  );
}
