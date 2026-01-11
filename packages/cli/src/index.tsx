#!/usr/bin/env bun
import { Command } from "commander";
import { render } from "ink";
import AppInstall from "./commands/app/install.js";
import AppRemove from "./commands/app/remove.js";
import AppList from "./commands/app.js";
import PluginInstall from "./commands/plugin/install.js";
import PluginRemove from "./commands/plugin/remove.js";
import PluginList from "./commands/plugin.js";
import { resetTerminal, setupTerminal } from "./lib/terminal.js";
import { TuiApp } from "./tui-app.js";
import { setupTls } from "./utils/tls.js";

// Ensure terminal is reset on exit
process.on("exit", resetTerminal);
// SIGINT is handled by the TUI for double Ctrl+C confirmation
process.on("SIGTERM", () => {
  resetTerminal();
  process.exit(0);
});

const DEFAULT_URL = "http://localhost:8000";

const program = new Command()
  .name("buntime")
  .description("Buntime CLI for managing plugins and apps")
  .version("1.0.0")
  .option("--url <url>", "Buntime server URL")
  .option("--token <token>", "Authentication token")
  .option("-k, --insecure", "Skip TLS certificate verification")
  .action((options) => {
    // No subcommand - launch TUI mode
    setupTls(options);
    setupTerminal();
    render(<TuiApp />);
  });

// Plugin commands
const pluginCmd = program
  .command("plugin")
  .description("Manage plugins")
  .option("--url <url>", "Buntime server URL", DEFAULT_URL)
  .option("-k, --insecure", "Skip TLS certificate verification")
  .action((options) => {
    setupTls(options);
    render(<PluginList options={options} />);
  });

pluginCmd
  .command("install <file>")
  .description("Install a plugin from a tarball (.tgz)")
  .option("--url <url>", "Buntime server URL", DEFAULT_URL)
  .option("--token <token>", "Authentication token")
  .option("-k, --insecure", "Skip TLS certificate verification")
  .action((file, options) => {
    setupTls(options);
    render(<PluginInstall args={[file]} options={options} />);
  });

pluginCmd
  .command("remove")
  .description("Remove an installed plugin")
  .option("--url <url>", "Buntime server URL", DEFAULT_URL)
  .option("--token <token>", "Authentication token")
  .option("--force", "Skip confirmation prompt", false)
  .option("-k, --insecure", "Skip TLS certificate verification")
  .action((options) => {
    setupTls(options);
    render(<PluginRemove options={options} />);
  });

// App commands
const appCmd = program
  .command("app")
  .description("Manage apps")
  .option("--url <url>", "Buntime server URL", DEFAULT_URL)
  .option("-k, --insecure", "Skip TLS certificate verification")
  .action((options) => {
    setupTls(options);
    render(<AppList options={options} />);
  });

appCmd
  .command("install <file>")
  .description("Install an app from a tarball (.tgz)")
  .option("--url <url>", "Buntime server URL", DEFAULT_URL)
  .option("--token <token>", "Authentication token")
  .option("-k, --insecure", "Skip TLS certificate verification")
  .action((file, options) => {
    setupTls(options);
    render(<AppInstall args={[file]} options={options} />);
  });

appCmd
  .command("remove")
  .description("Remove an installed app")
  .option("--url <url>", "Buntime server URL", DEFAULT_URL)
  .option("--token <token>", "Authentication token")
  .option("--force", "Skip confirmation prompt", false)
  .option("-k, --insecure", "Skip TLS certificate verification")
  .action((options) => {
    setupTls(options);
    render(<AppRemove options={options} />);
  });

program.parse();
