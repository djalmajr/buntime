package screens

import (
	"fmt"
	"strings"

	"github.com/buntime/cli/internal/api"
	"github.com/buntime/cli/internal/db"
	"github.com/buntime/cli/internal/tui/layout"
	"github.com/buntime/cli/internal/tui/styles"
	tea "github.com/charmbracelet/bubbletea"
)

// PluginsModel shows the plugins list
type PluginsModel struct {
	api     *api.Client
	server  *db.Server
	plugins []api.PluginInfo
	cursor  int
	width   int
	height  int
	loading bool
	err     error
}

// NewPluginsModel creates a plugins list screen
func NewPluginsModel(client *api.Client, server *db.Server, width, height int) *PluginsModel {
	return &PluginsModel{
		api:     client,
		server:  server,
		width:   width,
		height:  height,
		loading: true,
	}
}

func (m *PluginsModel) Init() tea.Cmd {
	return m.loadPlugins()
}

func (m *PluginsModel) loadPlugins() tea.Cmd {
	return func() tea.Msg {
		plugins, err := m.api.ListPlugins()
		if err != nil {
			return pluginsLoadedMsg{err: err}
		}
		return pluginsLoadedMsg{plugins: plugins}
	}
}

type pluginsLoadedMsg struct {
	plugins []api.PluginInfo
	err     error
}

func (m *PluginsModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case pluginsLoadedMsg:
		m.loading = false
		if msg.err != nil {
			m.err = msg.err
			return m, nil
		}
		m.plugins = msg.plugins
		return m, nil

	case pluginToggledMsg:
		if msg.err != nil {
			m.err = msg.err
			return m, nil
		}
		m.loading = true
		return m, m.loadPlugins()

	case tea.KeyMsg:
		switch msg.String() {
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "down", "j":
			if m.cursor < len(m.plugins)-1 {
				m.cursor++
			}
		case " ", "space":
			if len(m.plugins) > 0 && m.cursor < len(m.plugins) {
				return m, m.togglePlugin(&m.plugins[m.cursor])
			}
		case "i":
			return m, func() tea.Msg {
				return NavigateMsg{Screen: ScreenPluginInstall, Data: nil}
			}
		case "d":
			if len(m.plugins) > 0 && m.cursor < len(m.plugins) {
				return m, func() tea.Msg {
					return NavigateMsg{Screen: ScreenPluginRemove, Data: &m.plugins[m.cursor]}
				}
			}
		case "r":
			m.loading = true
			return m, m.loadPlugins()
		case "esc":
			return m, goBack()
		}
	}

	return m, nil
}

func (m *PluginsModel) togglePlugin(plugin *api.PluginInfo) tea.Cmd {
	return func() tea.Msg {
		var err error
		if plugin.Enabled {
			err = m.api.DisablePlugin(plugin.ID)
		} else {
			err = m.api.EnablePlugin(plugin.ID)
		}
		return pluginToggledMsg{err: err}
	}
}

type pluginToggledMsg struct {
	err error
}

func (m *PluginsModel) View() string {
	innerWidth := layout.InnerWidth(m.width)

	titleText := "PLUGINS"
	if !m.loading {
		enabled := 0
		for _, p := range m.plugins {
			if p.Enabled {
				enabled++
			}
		}
		titleText += fmt.Sprintf(" (%d enabled of %d)", enabled, len(m.plugins))
	}

	var content strings.Builder
	if m.loading {
		content.WriteString(styles.TextMuted.Render("Loading...") + "\n")
	} else if m.err != nil {
		content.WriteString(styles.TextError.Render("Error: "+m.err.Error()) + "\n")
	} else if len(m.plugins) == 0 {
		content.WriteString(m.renderEmptyState(innerWidth))
	} else {
		content.WriteString(m.renderPluginList(innerWidth))
	}

	return layout.Page(layout.PageConfig{
		Width:      m.width,
		Height:     m.height,
		Server:     m.server,
		Breadcrumb: "Main › Plugins",
		Title:      titleText,
		Content:    content.String(),
		Shortcuts:  m.getShortcuts(),
	})
}

func (m *PluginsModel) renderPluginList(width int) string {
	var b strings.Builder

	// Column widths
	statusWidth := 8
	nameWidth := 25
	versionWidth := 12
	baseWidth := width - statusWidth - nameWidth - versionWidth - 6

	// Header
	headerLine := fmt.Sprintf("  %-*s %-*s %-*s %-*s",
		statusWidth, "STATUS",
		nameWidth, "NAME",
		versionWidth, "VERSION",
		baseWidth, "BASE",
	)
	b.WriteString(styles.TextMuted.Render(headerLine) + "\n")
	b.WriteString(styles.TextMuted.Render(strings.Repeat("─", width)) + "\n")

	// Rows
	for i, plugin := range m.plugins {
		cursor := "  "
		if i == m.cursor {
			cursor = styles.Caret
		}

		status := styles.CheckDisabled
		if plugin.Enabled {
			status = styles.CheckEnabled
		}

		version := "-"
		if len(plugin.Versions) > 0 {
			version = plugin.Versions[0]
		}

		base := "-"
		if plugin.Base != "" {
			base = plugin.Base
		}

		name := styles.Truncate(plugin.Name, nameWidth)

		// Use PadRight for proper visual alignment (handles ANSI codes)
		line := styles.PadRight(status, statusWidth) + " " +
			styles.PadRight(name, nameWidth) + " " +
			styles.PadRight(version, versionWidth) + " " +
			styles.PadRight(base, baseWidth)

		if i == m.cursor {
			line = styles.TextPrimary.Render(line)
		}

		b.WriteString(cursor + line + "\n")
	}

	return b.String()
}

func (m *PluginsModel) renderEmptyState(width int) string {
	var b strings.Builder

	b.WriteString(layout.CenterText(styles.TextMuted.Render("No plugins installed."), width) + "\n")
	b.WriteString("\n")
	b.WriteString(layout.CenterText(styles.TextMuted.Render("Press 'i' to install your first plugin."), width) + "\n")

	return b.String()
}

func (m *PluginsModel) getShortcuts() []string {
	shortcuts := []string{
		styles.RenderShortcut("↑↓", "navigate"),
		styles.RenderShortcut("space", "toggle"),
		styles.RenderShortcut("i", "install"),
	}

	if len(m.plugins) > 0 {
		shortcuts = append(shortcuts, styles.RenderShortcut("d", "delete"))
	}

	shortcuts = append(shortcuts,
		styles.RenderShortcut("r", "refresh"),
		styles.RenderShortcut("Esc", "back"),
	)

	return shortcuts
}
