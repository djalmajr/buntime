import { TuiProvider, useTui } from "./context/tui-context.js";

// Screens
import { AddServerScreen } from "./screens/add-server.js";
import { AppInstallScreen } from "./screens/apps/app-install.js";
import { AppListScreen } from "./screens/apps/app-list.js";
import { AppMenuScreen } from "./screens/apps/app-menu.js";
import { AppRemoveScreen } from "./screens/apps/app-remove.js";
import { ConnectionErrorScreen } from "./screens/connection-error.js";
import { MainMenuScreen } from "./screens/main-menu.js";
import { PluginInstallScreen } from "./screens/plugins/plugin-install.js";
import { PluginListScreen } from "./screens/plugins/plugin-list.js";
import { PluginMenuScreen } from "./screens/plugins/plugin-menu.js";
import { PluginRemoveScreen } from "./screens/plugins/plugin-remove.js";
import { ServerSelectionScreen } from "./screens/server-selection.js";
import { SettingsScreen } from "./screens/settings/settings.js";
import { SettingsEditScreen } from "./screens/settings/settings-edit.js";
import { TestingConnectionScreen } from "./screens/testing-connection.js";
import { TokenPromptScreen } from "./screens/token-prompt.js";

function Router() {
  const { currentScreen } = useTui();

  switch (currentScreen.type) {
    case "add_server":
      return <AddServerScreen />;
    case "app_install":
      return <AppInstallScreen />;
    case "app_list":
      return <AppListScreen />;
    case "app_remove":
      return <AppRemoveScreen />;
    case "apps":
      return <AppMenuScreen />;
    case "connection_error":
      return (
        <ConnectionErrorScreen error={currentScreen.error} errorType={currentScreen.errorType} />
      );
    case "main_menu":
      return <MainMenuScreen />;
    case "plugin_install":
      return <PluginInstallScreen />;
    case "plugin_list":
      return <PluginListScreen />;
    case "plugin_remove":
      return <PluginRemoveScreen />;
    case "plugins":
      return <PluginMenuScreen />;
    case "select_server":
      return <ServerSelectionScreen />;
    case "settings":
      return <SettingsScreen />;
    case "settings_edit":
      return <SettingsEditScreen serverId={currentScreen.serverId} />;
    case "testing_connection":
      return <TestingConnectionScreen />;
    case "token_prompt":
      return <TokenPromptScreen message={currentScreen.message} />;
    default:
      return <MainMenuScreen />;
  }
}

export function TuiApp() {
  // Always start at server selection
  return (
    <TuiProvider initialConnection={null} initialScreen={{ type: "select_server" }}>
      <Router />
    </TuiProvider>
  );
}
