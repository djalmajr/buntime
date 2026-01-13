package screens

import (
	"fmt"
	"strings"

	"github.com/buntime/cli/internal/api"
	"github.com/buntime/cli/internal/db"
	"github.com/buntime/cli/internal/tui/layout"
	"github.com/buntime/cli/internal/tui/styles"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// MenuItem represents a menu item
type MenuItem struct {
	title       string
	description string
	screen      int
}

func (i MenuItem) Title() string       { return i.title }
func (i MenuItem) Description() string { return i.description }
func (i MenuItem) FilterValue() string { return i.title }

// MainMenuModel is the main menu screen
type MainMenuModel struct {
	api          *api.Client
	server       *db.Server
	menuItems    []MenuItem
	cursor       int
	width        int
	height       int
	appsCount    int
	pluginsCount int
	loading      bool
}

// NewMainMenuModel creates a main menu screen
func NewMainMenuModel(client *api.Client, server *db.Server, width, height int) *MainMenuModel {
	items := []MenuItem{
		{title: "Manage Apps", description: "View and manage applications", screen: ScreenApps},
		{title: "Manage Plugins", description: "Enable, disable, install plugins", screen: ScreenPlugins},
		{title: "API Keys", description: "Manage authentication keys", screen: ScreenKeys},
		{title: "Settings", description: "Server configuration", screen: ScreenSettings},
	}

	return &MainMenuModel{
		api:       client,
		server:    server,
		menuItems: items,
		width:     width,
		height:    height,
		loading:   true,
	}
}

func (m *MainMenuModel) Init() tea.Cmd {
	return m.loadStats()
}

func (m *MainMenuModel) loadStats() tea.Cmd {
	return func() tea.Msg {
		var appsCount, pluginsCount int

		apps, err := m.api.ListApps()
		if err == nil {
			appsCount = len(apps)
		}

		plugins, err := m.api.ListPlugins()
		if err == nil {
			for _, p := range plugins {
				if p.Enabled {
					pluginsCount++
				}
			}
		}

		return statsLoadedMsg{apps: appsCount, plugins: pluginsCount}
	}
}

type statsLoadedMsg struct {
	apps    int
	plugins int
}

func (m *MainMenuModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case statsLoadedMsg:
		m.loading = false
		m.appsCount = msg.apps
		m.pluginsCount = msg.plugins
		return m, nil

	case tea.KeyMsg:
		switch msg.String() {
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "down", "j":
			if m.cursor < len(m.menuItems)-1 {
				m.cursor++
			}
		case "enter":
			if m.cursor < len(m.menuItems) {
				return m, func() tea.Msg {
					return NavigateMsg{Screen: m.menuItems[m.cursor].screen, Data: nil}
				}
			}
		case "s", "esc":
			// Both 's' and ESC go back to server list
			return m, func() tea.Msg {
				return NavigateMsg{Screen: ScreenServerSelect, Data: nil}
			}
		case "r":
			m.loading = true
			return m, m.loadStats()
		}
	}

	return m, nil
}

func (m *MainMenuModel) View() string {
	innerWidth := layout.InnerWidth(m.width)

	// Build header
	header := layout.RenderHeader(innerWidth, "", m.server)

	var b strings.Builder

	// Stats cards
	b.WriteString(m.renderStats(innerWidth))
	b.WriteString("\n")

	// Quick actions title
	b.WriteString(styles.SectionTitle.Render("QUICK ACTIONS") + "\n")

	// Menu items
	for i, item := range m.menuItems {
		cursor := "  "
		if i == m.cursor {
			cursor = styles.Caret
		}

		title := item.title
		desc := styles.TextMuted.Render(" - " + item.description)

		if i == m.cursor {
			title = styles.TextPrimary.Bold(true).Render(title)
		} else {
			title = styles.TextNormal.Render(title)
		}

		b.WriteString(cursor + title + desc + "\n")
	}

	// Build footer
	var footer strings.Builder
	footer.WriteString(layout.Divider(innerWidth) + "\n")
	footer.WriteString(m.renderShortcuts())

	return layout.ScreenWithHeader(m.width, m.height, header, b.String(), footer.String())
}

func (m *MainMenuModel) renderStats(width int) string {
	cardWidth := 20

	// Apps card
	appsCard := m.renderStatCard("APPS", m.appsCount, "running", cardWidth)

	// Plugins card
	pluginsCard := m.renderStatCard("PLUGINS", m.pluginsCount, "enabled", cardWidth)

	return lipgloss.JoinHorizontal(lipgloss.Center, appsCard, "  ", pluginsCard)
}

func (m *MainMenuModel) renderStatCard(title string, count int, label string, cardWidth int) string {
	contentWidth := cardWidth - 4

	titleStyle := styles.TextMuted.Width(contentWidth).Align(lipgloss.Center)
	countStyle := styles.BoldPrimary.Width(contentWidth).Align(lipgloss.Center)
	labelStyle := styles.TextMuted.Width(contentWidth).Align(lipgloss.Center)

	countText := "-"
	if !m.loading {
		countText = formatNumber(count)
	}

	content := lipgloss.JoinVertical(
		lipgloss.Center,
		titleStyle.Render(title),
		"",
		countStyle.Render(countText),
		labelStyle.Render(label),
	)

	return styles.Card.Width(cardWidth).Render(content)
}

func (m *MainMenuModel) renderShortcuts() string {
	shortcuts := []string{
		styles.RenderShortcut("↑↓", "navigate"),
		styles.RenderShortcut("⏎", "select"),
		styles.RenderShortcut("s", "servers"),
		styles.RenderShortcut("r", "refresh"),
		styles.RenderShortcut("Esc", "back"),
	}

	return layout.Shortcuts(shortcuts)
}

func formatNumber(n int) string {
	if n >= 1000 {
		return fmt.Sprintf("%dk", n/1000)
	}
	return fmt.Sprintf("%d", n)
}
