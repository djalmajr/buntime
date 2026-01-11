import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { useEffect, useState } from "react";
import { Label } from "../../components/label.js";
import { Layout } from "../../components/layout.js";
import { Logo } from "../../components/logo.js";
import { Table } from "../../components/table.js";
import { useTui } from "../../context/tui-context.js";
import type { AppInfo } from "../../lib/api-client.js";

interface VersionedApp {
  name: string;
  path: string;
  version: string;
}

export function AppListScreen() {
  const { api, goBack, navigate } = useTui();
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useInput((input, key) => {
    if (key.escape) {
      goBack();
      return;
    }
    if (input === "r") {
      fetchApps();
      return;
    }
    if (input === "i") {
      navigate({ type: "app_install" });
      return;
    }
    if (input === "d" && apps.length > 0) {
      navigate({ type: "app_remove" });
      return;
    }
  });

  const fetchApps = async () => {
    if (!api) return;

    setLoading(true);
    setError(null);

    try {
      const data = await api.listApps();
      setApps(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApps();
  }, [api]);

  // Flatten apps to show each version separately
  const versionedApps: VersionedApp[] = apps.flatMap((app) =>
    app.versions.map((version) => ({
      name: `${app.name}@${version}`,
      path: `${app.path}/${version}`,
      version,
    })),
  );

  const tableData = versionedApps.map((a) => ({
    App: a.name,
    Path: a.path,
  }));

  const shortcuts = [
    { action: "Install", key: "i" },
    ...(apps.length > 0 ? [{ action: "Delete", key: "d" }] : []),
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
          <Label> Loading apps...</Label>
        </Box>
      )}

      {error && (
        <Box flexDirection="column">
          <Text color="red">Error: {error}</Text>
          <Label muted>Press 'r' to retry</Label>
        </Box>
      )}

      {!loading && !error && versionedApps.length === 0 && (
        <Box alignItems="center" flexDirection="column" marginTop={1}>
          <Text color="red">x Error</Text>
          <Box marginTop={1}>
            <Label muted>No apps installed</Label>
          </Box>
        </Box>
      )}

      {!loading && !error && versionedApps.length > 0 && (
        <>
          <Label selected bold>
            Installed Apps ({versionedApps.length})
          </Label>
          <Box marginTop={1}>
            <Table data={tableData} />
          </Box>
        </>
      )}
    </Layout>
  );
}
