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

type settingsState int

const (
	settingsStateMenu settingsState = iota
	settingsStateConfirmDelete
	settingsStateDeleting
)

type settingsAction int

const (
	actionEditServer settingsAction = iota
	actionToggleInsecure
	actionDeleteServer
)

type settingsMenuItem struct {
	action      settingsAction
	title       string
	description string
}

// SettingsModel handles the settings screen
type SettingsModel struct {
	api          *api.Client
	db           *db.DB
	server       *db.Server
	width        int
	height       int
	cursor       int
	menuItems    []settingsMenuItem
	health       *api.HealthInfo
	loading      bool
	state        settingsState
	confirmInput string
	err          error
}

// NewSettingsModel creates a new settings screen
func NewSettingsModel(client *api.Client, database *db.DB, server *db.Server, width, height int) *SettingsModel {
	items := []settingsMenuItem{
		{action: actionEditServer, title: "Edit Server", description: "Change name, URL or token"},
		{action: actionToggleInsecure, title: "Toggle Insecure Mode", description: "Skip TLS verification"},
		{action: actionDeleteServer, title: "Delete Server", description: "Remove from saved servers"},
	}

	return &SettingsModel{
		api:       client,
		db:        database,
		server:    server,
		width:     width,
		height:    height,
		menuItems: items,
		loading:   true,
		state:     settingsStateMenu,
	}
}

func (m *SettingsModel) Init() tea.Cmd {
	return m.loadHealth()
}

func (m *SettingsModel) loadHealth() tea.Cmd {
	return func() tea.Msg {
		health, err := m.api.GetHealth()
		return healthLoadedMsg{health: health, err: err}
	}
}

type healthLoadedMsg struct {
	health *api.HealthInfo
	err    error
}

type serverDeletedMsg struct {
	err error
}

func (m *SettingsModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case healthLoadedMsg:
		m.loading = false
		m.health = msg.health
		if msg.err != nil {
			m.err = msg.err
		}
		return m, nil

	case serverDeletedMsg:
		m.state = settingsStateMenu
		if msg.err != nil {
			m.err = msg.err
			return m, nil
		}
		return m, func() tea.Msg {
			return NavigateMsg{Screen: ScreenServerSelect, Data: nil}
		}

	case serverUpdatedMsg:
		if msg.server != nil {
			m.server = msg.server
		}
		return m, nil

	case tea.KeyMsg:
		switch m.state {
		case settingsStateMenu:
			return m.updateMenu(msg)
		case settingsStateConfirmDelete:
			return m.updateConfirmDelete(msg)
		case settingsStateDeleting:
			return m, nil
		}
	}

	return m, nil
}

func (m *SettingsModel) updateMenu(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
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
		return m.handleAction()
	case "r":
		m.loading = true
		m.err = nil
		return m, m.loadHealth()
	case "esc":
		return m, goBack()
	}
	return m, nil
}

func (m *SettingsModel) updateConfirmDelete(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.state = settingsStateMenu
		m.confirmInput = ""
		return m, nil
	case "backspace":
		if len(m.confirmInput) > 0 {
			m.confirmInput = m.confirmInput[:len(m.confirmInput)-1]
		}
	case "enter":
		if m.confirmInput == m.server.Name {
			m.state = settingsStateDeleting
			return m, m.deleteServer()
		}
	default:
		if len(msg.String()) == 1 && len(m.confirmInput) < len(m.server.Name) {
			m.confirmInput += msg.String()
		}
	}
	return m, nil
}

func (m *SettingsModel) handleAction() (tea.Model, tea.Cmd) {
	item := m.menuItems[m.cursor]

	switch item.action {
	case actionEditServer:
		return m, func() tea.Msg {
			return NavigateMsg{Screen: ScreenEditServer, Data: m.server}
		}
	case actionToggleInsecure:
		return m, m.toggleInsecure()
	case actionDeleteServer:
		m.state = settingsStateConfirmDelete
		m.confirmInput = ""
		return m, nil
	}

	return m, nil
}

func (m *SettingsModel) toggleInsecure() tea.Cmd {
	newInsecure := !m.server.Insecure
	return func() tea.Msg {
		err := m.db.UpdateServer(m.server.ID, m.server.Name, m.server.URL, m.server.Token, newInsecure)
		if err != nil {
			return healthLoadedMsg{err: err}
		}
		server, _ := m.db.GetServer(m.server.ID)
		return serverUpdatedMsg{server: server}
	}
}

type serverUpdatedMsg struct {
	server *db.Server
}

func (m *SettingsModel) deleteServer() tea.Cmd {
	return func() tea.Msg {
		err := m.db.DeleteServer(m.server.ID)
		return serverDeletedMsg{err: err}
	}
}

func (m *SettingsModel) View() string {
	innerWidth := layout.InnerWidth(m.width)

	return layout.Page(layout.PageConfig{
		Width:      m.width,
		Height:     m.height,
		Server:     m.server,
		Breadcrumb: "Main › Settings",
		Title:      "SETTINGS",
		Content:    m.renderContent(innerWidth),
		Shortcuts:  m.getShortcuts(),
	})
}

func (m *SettingsModel) renderContent(width int) string {
	switch m.state {
	case settingsStateConfirmDelete:
		return m.renderConfirmDelete(width)
	case settingsStateDeleting:
		return m.renderDeleting()
	default:
		return m.renderMenu(width)
	}
}

func (m *SettingsModel) renderMenu(width int) string {
	var b strings.Builder

	// Server info card
	b.WriteString(m.renderServerInfo(width))
	b.WriteString("\n\n")

	// Actions section
	b.WriteString(styles.TextMuted.Render("ACTIONS") + "\n\n")

	for i, item := range m.menuItems {
		b.WriteString(m.renderMenuItem(i, item))
		b.WriteString("\n")
	}

	// Error message
	if m.err != nil {
		b.WriteString("\n")
		b.WriteString(styles.TextError.Render("Error: " + m.err.Error()) + "\n")
	}

	return b.String()
}

func (m *SettingsModel) renderConfirmDelete(width int) string {
	return layout.ConfirmModal(layout.ConfirmModalConfig{
		Width:       width - 4,
		Warning:     "You are about to delete the following server:",
		ConfirmWord: m.server.Name,
		Items: []layout.ConfirmModalItem{
			{Label: "Name", Value: m.server.Name},
			{Label: "URL", Value: m.server.URL},
		},
		CurrentInput: m.confirmInput,
	})
}

func (m *SettingsModel) renderDeleting() string {
	var b strings.Builder

	b.WriteString(styles.TextWarning.Render("Deleting server...") + "\n\n")
	b.WriteString(styles.TextMuted.Render("  - " + m.server.Name) + "\n")

	return b.String()
}

func (m *SettingsModel) renderServerInfo(width int) string {
	var content strings.Builder

	// Name
	content.WriteString(styles.TextMuted.Render("Name: "))
	content.WriteString(styles.TextNormal.Render(m.server.Name) + "\n")

	// URL
	content.WriteString(styles.TextMuted.Render("URL: "))
	content.WriteString(styles.TextNormal.Render(m.server.URL) + "\n")

	// Version
	content.WriteString(styles.TextMuted.Render("Version: "))
	if m.loading {
		content.WriteString(styles.TextMuted.Render("loading...") + "\n")
	} else if m.health != nil {
		content.WriteString(styles.TextNormal.Render(m.health.Version) + "\n")
	} else {
		content.WriteString(styles.TextMuted.Render("-") + "\n")
	}

	// Status
	content.WriteString(styles.TextMuted.Render("Status: "))
	if m.loading {
		content.WriteString(styles.TextMuted.Render("checking...") + "\n")
	} else if m.health != nil && m.health.OK {
		content.WriteString(styles.TextSuccess.Render("● connected") + "\n")
	} else {
		content.WriteString(styles.TextError.Render("● disconnected") + "\n")
	}

	// Insecure mode
	content.WriteString(styles.TextMuted.Render("TLS Verification: "))
	if m.server.Insecure {
		content.WriteString(styles.TextWarning.Render("disabled (insecure)") + "\n")
	} else {
		content.WriteString(styles.TextSuccess.Render("enabled") + "\n")
	}

	// Token status
	content.WriteString(styles.TextMuted.Render("Token: "))
	if m.server.Token != nil && *m.server.Token != "" {
		content.WriteString(styles.TextSuccess.Render("configured"))
	} else {
		content.WriteString(styles.TextMuted.Render("not set"))
	}

	return layout.Card(layout.CardConfig{
		Width:   width - 4,
		Variant: layout.CardDefault,
		Content: content.String(),
	})
}

func (m *SettingsModel) renderMenuItem(index int, item settingsMenuItem) string {
	cursor := "  "
	if index == m.cursor {
		cursor = styles.Caret
	}

	title := item.title
	desc := styles.TextMuted.Render(" - " + item.description)

	if index == m.cursor {
		title = styles.TextPrimary.Bold(true).Render(title)
	} else {
		title = styles.TextNormal.Render(title)
	}

	return fmt.Sprintf("%s%s%s", cursor, title, desc)
}

func (m *SettingsModel) getShortcuts() []string {
	switch m.state {
	case settingsStateConfirmDelete:
		return []string{
			styles.RenderShortcut("Esc", "cancel"),
		}
	case settingsStateDeleting:
		return []string{}
	default:
		return []string{
			styles.RenderShortcut("↑↓", "navigate"),
			styles.RenderShortcut("⏎", "select"),
			styles.RenderShortcut("r", "refresh"),
			styles.RenderShortcut("Esc", "back"),
		}
	}
}
