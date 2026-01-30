package main

import (
	"fmt"
	"os"

	"github.com/buntime/cli/internal/api"
	"github.com/buntime/cli/internal/db"
	"github.com/buntime/cli/internal/tui"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/spf13/cobra"
)

var (
	version = "1.0.0"

	// Global flags
	serverURL string
	token     string
	insecure  bool
)

func main() {
	rootCmd := &cobra.Command{
		Use:     "buntime",
		Short:   "Buntime CLI - Runtime Worker Pool Manager",
		Version: version,
		RunE:    runTUI,
	}

	// Global flags
	rootCmd.PersistentFlags().StringVarP(&serverURL, "url", "u", "", "Server URL")
	rootCmd.PersistentFlags().StringVarP(&token, "token", "t", "", "Authentication token")
	rootCmd.PersistentFlags().BoolVarP(&insecure, "insecure", "k", false, "Skip TLS certificate verification")

	// Plugin commands
	pluginCmd := &cobra.Command{
		Use:   "plugin",
		Short: "Manage plugins",
	}

	pluginListCmd := &cobra.Command{
		Use:   "list",
		Short: "List installed plugins",
		RunE:  runPluginList,
	}

	pluginInstallCmd := &cobra.Command{
		Use:   "install <file>",
		Short: "Install a plugin from tarball",
		Args:  cobra.ExactArgs(1),
		RunE:  runPluginInstall,
	}

	pluginRemoveCmd := &cobra.Command{
		Use:   "remove <name> [version]",
		Short: "Remove a plugin",
		Args:  cobra.RangeArgs(1, 2),
		RunE:  runPluginRemove,
	}

	pluginEnableCmd := &cobra.Command{
		Use:   "enable <name>",
		Short: "Enable a plugin",
		Args:  cobra.ExactArgs(1),
		RunE:  runPluginEnable,
	}

	pluginDisableCmd := &cobra.Command{
		Use:   "disable <name>",
		Short: "Disable a plugin",
		Args:  cobra.ExactArgs(1),
		RunE:  runPluginDisable,
	}

	pluginCmd.AddCommand(pluginListCmd, pluginInstallCmd, pluginRemoveCmd, pluginEnableCmd, pluginDisableCmd)

	// App commands
	appCmd := &cobra.Command{
		Use:   "app",
		Short: "Manage applications",
	}

	appListCmd := &cobra.Command{
		Use:   "list",
		Short: "List installed apps",
		RunE:  runAppList,
	}

	appInstallCmd := &cobra.Command{
		Use:   "install <file>",
		Short: "Install an app from tarball",
		Args:  cobra.ExactArgs(1),
		RunE:  runAppInstall,
	}

	appRemoveCmd := &cobra.Command{
		Use:   "remove <name> [version]",
		Short: "Remove an app",
		Args:  cobra.RangeArgs(1, 2),
		RunE:  runAppRemove,
	}

	appCmd.AddCommand(appListCmd, appInstallCmd, appRemoveCmd)

	// Add subcommands
	rootCmd.AddCommand(pluginCmd, appCmd)

	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func runTUI(cmd *cobra.Command, args []string) error {
	// Initialize database
	database, err := db.New()
	if err != nil {
		return fmt.Errorf("failed to initialize database: %w", err)
	}
	defer database.Close()

	// Create TUI model
	model := tui.NewModel(database)

	// If URL provided via CLI, skip server selection
	if serverURL != "" {
		client := api.New(serverURL, token, insecure)
		if err := client.Ping(); err != nil {
			// Check if auth required
			if apiErr, ok := err.(*api.APIError); ok && apiErr.Type == api.ErrorTypeAuthRequired {
				return fmt.Errorf("authentication required. Use --token flag")
			}
			return fmt.Errorf("connection failed: %w", err)
		}

		// Save server if not exists
		existing, _ := database.GetServerByURL(serverURL)
		if existing == nil {
			database.CreateServer("CLI", serverURL, &token, insecure)
		}
	}

	// Run Bubble Tea
	p := tea.NewProgram(model, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		return err
	}

	return nil
}

func getClient() (*api.Client, error) {
	if serverURL == "" {
		return nil, fmt.Errorf("server URL required. Use --url flag or run in TUI mode")
	}

	client := api.New(serverURL, token, insecure)
	if err := client.Ping(); err != nil {
		return nil, err
	}

	return client, nil
}

// Plugin commands

func runPluginList(cmd *cobra.Command, args []string) error {
	client, err := getClient()
	if err != nil {
		return err
	}

	plugins, err := client.ListPlugins()
	if err != nil {
		return err
	}

	if len(plugins) == 0 {
		fmt.Println("No plugins installed.")
		return nil
	}

	fmt.Printf("%-8s %-30s %-15s %s\n", "STATUS", "NAME", "VERSION", "BASE")
	fmt.Println("--------------------------------------------------------------")

	for _, p := range plugins {
		status := "disabled"
		if p.Enabled {
			status = "enabled"
		}

		version := "-"
		if len(p.Versions) > 0 {
			version = p.Versions[0]
		}

		base := "-"
		if p.Base != "" {
			base = p.Base
		}

		fmt.Printf("%-8s %-30s %-15s %s\n", status, p.Name, version, base)
	}

	return nil
}

func runPluginInstall(cmd *cobra.Command, args []string) error {
	client, err := getClient()
	if err != nil {
		return err
	}

	result, err := client.InstallPlugin(args[0])
	if err != nil {
		return err
	}

	fmt.Printf("Installed %s v%s at %s\n", result.Name, result.Version, result.Path)
	return nil
}

// findPluginByName looks up a plugin by name and returns its ID
func findPluginByName(client *api.Client, name string) (int, error) {
	plugins, err := client.ListPlugins()
	if err != nil {
		return 0, err
	}

	for _, p := range plugins {
		if p.Name == name {
			return p.ID, nil
		}
	}

	return 0, fmt.Errorf("plugin not found: %s", name)
}

func runPluginRemove(cmd *cobra.Command, args []string) error {
	client, err := getClient()
	if err != nil {
		return err
	}

	name := args[0]
	id, err := findPluginByName(client, name)
	if err != nil {
		return err
	}

	if err := client.RemovePlugin(id); err != nil {
		return err
	}

	fmt.Printf("Removed plugin %s\n", name)
	return nil
}

func runPluginEnable(cmd *cobra.Command, args []string) error {
	client, err := getClient()
	if err != nil {
		return err
	}

	name := args[0]
	id, err := findPluginByName(client, name)
	if err != nil {
		return err
	}

	if err := client.EnablePlugin(id); err != nil {
		return err
	}

	fmt.Printf("Enabled %s\n", name)
	return nil
}

func runPluginDisable(cmd *cobra.Command, args []string) error {
	client, err := getClient()
	if err != nil {
		return err
	}

	name := args[0]
	id, err := findPluginByName(client, name)
	if err != nil {
		return err
	}

	if err := client.DisablePlugin(id); err != nil {
		return err
	}

	fmt.Printf("Disabled %s\n", name)
	return nil
}

// App commands

func runAppList(cmd *cobra.Command, args []string) error {
	client, err := getClient()
	if err != nil {
		return err
	}

	apps, err := client.ListApps()
	if err != nil {
		return err
	}

	if len(apps) == 0 {
		fmt.Println("No apps installed.")
		return nil
	}

	fmt.Printf("%-30s %-15s %s\n", "NAME", "VERSION", "PATH")
	fmt.Println("--------------------------------------------------------------")

	for _, a := range apps {
		version := "-"
		if len(a.Versions) > 0 {
			version = a.Versions[0]
		}

		fmt.Printf("%-30s %-15s %s\n", a.Name, version, a.Path)
	}

	return nil
}

func runAppInstall(cmd *cobra.Command, args []string) error {
	client, err := getClient()
	if err != nil {
		return err
	}

	result, err := client.InstallApp(args[0])
	if err != nil {
		return err
	}

	fmt.Printf("Installed %s v%s at %s\n", result.Name, result.Version, result.Path)
	return nil
}

func runAppRemove(cmd *cobra.Command, args []string) error {
	client, err := getClient()
	if err != nil {
		return err
	}

	name := args[0]
	version := "all"
	if len(args) > 1 {
		version = args[1]
	}

	if err := client.RemoveApp(name, version); err != nil {
		return err
	}

	fmt.Printf("Removed %s v%s\n", name, version)
	return nil
}
