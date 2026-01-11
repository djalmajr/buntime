import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { useEffect } from "react";
import { Label } from "../components/label.js";
import { Layout } from "../components/layout.js";
import { Logo } from "../components/logo.js";
import { useTui } from "../context/tui-context.js";
import { ApiClient, ApiError } from "../lib/api-client.js";
import { setLastServerId, touchServer } from "../lib/config-db.js";

export function TestingConnectionScreen() {
  const { connection, navigate, replace, setApi } = useTui();

  useEffect(() => {
    if (!connection) {
      replace({ type: "add_server" });
      return;
    }

    const client = new ApiClient({
      insecure: connection.insecure,
      token: connection.token,
      url: connection.url,
    });

    const testConnection = async () => {
      try {
        await client.testConnection();
        setApi(client);

        // Update last used
        if (connection.serverId) {
          touchServer(connection.serverId);
          setLastServerId(connection.serverId);
        }

        // Navigate directly to main menu
        navigate({ type: "main_menu" });
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.type === "auth_required") {
            // Need token - show token prompt
            navigate({ type: "token_prompt" });
            return;
          }

          if (err.type === "tls_error") {
            replace({
              error: err.message,
              errorType: "tls_error",
              type: "connection_error",
            });
            return;
          }

          replace({
            error: err.message,
            errorType: err.type,
            type: "connection_error",
          });
          return;
        }

        const message = err instanceof Error ? err.message : "Unknown error";
        replace({
          error: message,
          errorType: "unknown",
          type: "connection_error",
        });
      }
    };

    testConnection();
  }, [connection, navigate, replace, setApi]);

  return (
    <Layout>
      <Logo />
      <Box alignItems="center" flexDirection="column" flexGrow={1} justifyContent="center">
        <Box>
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Label> Connecting...</Label>
        </Box>
        <Box marginTop={1}>
          <Label muted>{connection?.url}</Label>
        </Box>
      </Box>
    </Layout>
  );
}
