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

// AppsModel shows the apps list
type AppsModel struct {
	api     *api.Client
	server  *db.Server
	apps    []api.AppInfo
	cursor  int
	width   int
	height  int
	loading bool
	err     error
}

// NewAppsModel creates an apps list screen
func NewAppsModel(client *api.Client, server *db.Server, width, height int) *AppsModel {
	return &AppsModel{
		api:     client,
		server:  server,
		width:   width,
		height:  height,
		loading: true,
	}
}

func (m *AppsModel) Init() tea.Cmd {
	return m.loadApps()
}

func (m *AppsModel) loadApps() tea.Cmd {
	return func() tea.Msg {
		apps, err := m.api.ListApps()
		if err != nil {
			return appsLoadedMsg{err: err}
		}
		return appsLoadedMsg{apps: apps}
	}
}

type appsLoadedMsg struct {
	apps []api.AppInfo
	err  error
}

func (m *AppsModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case appsLoadedMsg:
		m.loading = false
		if msg.err != nil {
			m.err = msg.err
			return m, nil
		}
		m.apps = msg.apps
		return m, nil

	case tea.KeyMsg:
		switch msg.String() {
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "down", "j":
			if m.cursor < len(m.apps)-1 {
				m.cursor++
			}
		case "i":
			return m, func() tea.Msg {
				return NavigateMsg{Screen: ScreenAppInstall, Data: nil}
			}
		case "d":
			if len(m.apps) > 0 && m.cursor < len(m.apps) {
				return m, func() tea.Msg {
					return NavigateMsg{Screen: ScreenAppRemove, Data: &m.apps[m.cursor]}
				}
			}
		case "r":
			m.loading = true
			return m, m.loadApps()
		case "esc":
			return m, goBack()
		}
	}

	return m, nil
}

func (m *AppsModel) View() string {
	innerWidth := layout.InnerWidth(m.width)

	titleText := "APPLICATIONS"
	if !m.loading {
		titleText += fmt.Sprintf(" (%d)", len(m.apps))
	}

	var content strings.Builder
	if m.loading {
		content.WriteString(styles.TextMuted.Render("Loading...") + "\n")
	} else if m.err != nil {
		content.WriteString(styles.TextError.Render("Error: "+m.err.Error()) + "\n")
	} else if len(m.apps) == 0 {
		content.WriteString(m.renderEmptyState(innerWidth))
	} else {
		content.WriteString(m.renderAppList(innerWidth))
	}

	return layout.Page(layout.PageConfig{
		Width:      m.width,
		Height:     m.height,
		Server:     m.server,
		Breadcrumb: "Main › Apps",
		Title:      titleText,
		Content:    content.String(),
		Shortcuts:  m.getShortcuts(),
	})
}

func (m *AppsModel) renderAppList(width int) string {
	var b strings.Builder

	// Column widths
	nameWidth := 25
	versionWidth := 15
	pathWidth := width - nameWidth - versionWidth - 6

	// Header
	headerLine := fmt.Sprintf("  %-*s %-*s %-*s",
		nameWidth, "NAME",
		versionWidth, "VERSION",
		pathWidth, "PATH",
	)
	b.WriteString(styles.TextMuted.Render(headerLine) + "\n")
	b.WriteString(styles.TextMuted.Render(strings.Repeat("─", width)) + "\n")

	// Rows
	for i, app := range m.apps {
		cursor := "  "
		if i == m.cursor {
			cursor = styles.Caret
		}

		version := "-"
		if len(app.Versions) > 0 {
			version = app.Versions[0]
			if len(app.Versions) > 1 {
				version += fmt.Sprintf(" (+%d)", len(app.Versions)-1)
			}
		}

		name := styles.Truncate(app.Name, nameWidth)
		path := styles.Truncate(app.Path, pathWidth)

		// Use PadRight for proper visual alignment
		line := styles.PadRight(name, nameWidth) + " " +
			styles.PadRight(version, versionWidth) + " " +
			styles.PadRight(path, pathWidth)

		if i == m.cursor {
			line = styles.TextPrimary.Render(line)
		}

		b.WriteString(cursor + line + "\n")
	}

	return b.String()
}

func (m *AppsModel) renderEmptyState(width int) string {
	var b strings.Builder

	b.WriteString(layout.CenterText(styles.TextMuted.Render("No applications installed."), width) + "\n")
	b.WriteString("\n")
	b.WriteString(layout.CenterText(styles.TextMuted.Render("Press 'i' to install your first app."), width) + "\n")

	return b.String()
}

func (m *AppsModel) getShortcuts() []string {
	shortcuts := []string{
		styles.RenderShortcut("↑↓", "navigate"),
		styles.RenderShortcut("i", "install"),
	}

	if len(m.apps) > 0 {
		shortcuts = append(shortcuts, styles.RenderShortcut("d", "delete"))
	}

	shortcuts = append(shortcuts,
		styles.RenderShortcut("r", "refresh"),
		styles.RenderShortcut("Esc", "back"),
	)

	return shortcuts
}
