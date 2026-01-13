package screens

import (
	"fmt"
	"strings"

	"github.com/buntime/cli/internal/api"
	"github.com/buntime/cli/internal/db"
	"github.com/buntime/cli/internal/tui/layout"
	"github.com/buntime/cli/internal/tui/messages"
	"github.com/buntime/cli/internal/tui/styles"
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/dustin/go-humanize"
)

// HealthStatus represents the health check result for a server
type HealthStatus int

const (
	HealthUnknown HealthStatus = iota
	HealthChecking
	HealthOnline
	HealthOffline
)

// ServerSelectModel is the server selection screen
type ServerSelectModel struct {
	db            *db.DB
	servers       []db.Server
	cursor        int
	spinner       spinner.Model
	connecting    bool
	connectingIdx int
	width         int
	height        int
	err           error
	healthStatus  map[int64]HealthStatus // server ID -> health status

	// Delete confirmation
	confirmingDelete bool
	deleteTarget     *db.Server
}

// NewServerSelectModel creates a new server selection screen
func NewServerSelectModel(database *db.DB, width, height int) *ServerSelectModel {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = styles.TextPrimary

	return &ServerSelectModel{
		db:            database,
		spinner:       s,
		connectingIdx: -1,
		width:         width,
		height:        height,
		healthStatus:  make(map[int64]HealthStatus),
	}
}

func (m *ServerSelectModel) Init() tea.Cmd {
	return m.loadServers
}

func (m *ServerSelectModel) loadServers() tea.Msg {
	servers, err := m.db.ListServers()
	if err != nil {
		return serversLoadedMsg{err: err}
	}
	return serversLoadedMsg{servers: servers}
}

type serversLoadedMsg struct {
	servers []db.Server
	err     error
}

type healthCheckMsg struct {
	serverID int64
	online   bool
}

func (m *ServerSelectModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case serversLoadedMsg:
		if msg.err != nil {
			m.err = msg.err
			return m, nil
		}
		m.servers = msg.servers
		// Reset cursor if out of bounds
		if m.cursor >= len(m.servers) {
			m.cursor = max(0, len(m.servers)-1)
		}
		// Start health checks for all servers
		return m, m.checkAllHealth()

	case healthCheckMsg:
		if msg.online {
			m.healthStatus[msg.serverID] = HealthOnline
		} else {
			m.healthStatus[msg.serverID] = HealthOffline
		}
		return m, nil

	case spinner.TickMsg:
		if m.connecting {
			var cmd tea.Cmd
			m.spinner, cmd = m.spinner.Update(msg)
			return m, cmd
		}
		return m, nil

	case connectionResultMsg:
		m.connecting = false
		idx := m.connectingIdx
		m.connectingIdx = -1

		if msg.err != nil {
			if apiErr, ok := msg.err.(*api.APIError); ok {
				if apiErr.Type == api.ErrorTypeAuthRequired {
					if idx >= 0 && idx < len(m.servers) {
						server := m.servers[idx]
						return m, navigateToTokenPrompt(&server)
					}
				}
			}
			return m, func() tea.Msg {
				return messages.ShowError("Connection failed: " + msg.err.Error())
			}
		}

		if idx >= 0 && idx < len(m.servers) {
			server := m.servers[idx]
			m.db.TouchServer(server.ID)
			return m, func() tea.Msg {
				return ConnectedMsg{Client: msg.client, Server: &server}
			}
		}
		return m, nil

	case tea.KeyMsg:
		// Handle delete confirmation modal
		if m.confirmingDelete {
			switch msg.String() {
			case "y", "Y", "enter":
				if m.deleteTarget != nil {
					m.confirmingDelete = false
					target := m.deleteTarget
					m.deleteTarget = nil
					return m, m.deleteServer(target)
				}
			case "n", "N", "esc":
				m.confirmingDelete = false
				m.deleteTarget = nil
			}
			return m, nil
		}

		if m.connecting {
			if msg.String() == "esc" {
				m.connecting = false
				m.connectingIdx = -1
				return m, nil
			}
			return m, nil
		}

		switch msg.String() {
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "down", "j":
			if m.cursor < len(m.servers)-1 {
				m.cursor++
			}
		case "enter":
			if len(m.servers) > 0 && m.cursor < len(m.servers) {
				return m, m.connectToServer(&m.servers[m.cursor])
			}
		case "a":
			return m, navigateToAddServer()
		case "e":
			if len(m.servers) > 0 && m.cursor < len(m.servers) {
				return m, navigateToEditServer(&m.servers[m.cursor])
			}
		case "d":
			if len(m.servers) > 0 && m.cursor < len(m.servers) {
				m.confirmingDelete = true
				m.deleteTarget = &m.servers[m.cursor]
				return m, nil
			}
		case "r":
			// Reset health status and reload
			m.healthStatus = make(map[int64]HealthStatus)
			return m, m.loadServers
		}
		return m, nil
	}

	return m, nil
}

func (m *ServerSelectModel) connectToServer(server *db.Server) tea.Cmd {
	m.connecting = true
	m.connectingIdx = m.cursor

	return tea.Batch(
		m.spinner.Tick,
		func() tea.Msg {
			var token string
			if server.Token != nil {
				token = *server.Token
			}
			client := api.New(server.URL, token, server.Insecure)
			err := client.Ping()
			if err != nil {
				return connectionResultMsg{err: err, client: client}
			}
			return connectionResultMsg{client: client}
		},
	)
}

func (m *ServerSelectModel) renderServerRow(idx int, server db.Server, width int) string {
	// Status dot based on health check
	var dot string
	if m.connecting && m.connectingIdx == idx {
		dot = m.spinner.View()
	} else {
		switch m.healthStatus[server.ID] {
		case HealthOnline:
			dot = styles.DotConnected
		case HealthOffline:
			dot = styles.DotDisconnected
		case HealthChecking:
			dot = styles.TextMuted.Render("◌") // checking indicator
		default:
			dot = styles.TextMuted.Render("○") // unknown
		}
	}

	// Time ago
	timeAgo := ""
	if server.LastUsedAt != nil {
		timeAgo = humanize.Time(*server.LastUsedAt)
	}

	// Cursor
	cursor := "  "
	if idx == m.cursor {
		cursor = styles.Caret
	}

	// Build row - calculate widths
	nameWidth := 20
	timeWidth := 18
	urlWidth := width - nameWidth - timeWidth - 6 // 6 for dot, cursor, spacing
	if urlWidth < 20 {
		urlWidth = 20
	}

	name := truncate(server.Name, nameWidth)
	url := truncate(server.URL, urlWidth)
	time := truncate(timeAgo, timeWidth)

	line := fmt.Sprintf("%s %-*s %-*s %s", dot, nameWidth, name, urlWidth, url, time)

	if idx == m.cursor {
		line = styles.TextPrimary.Render(line)
	}

	return cursor + line
}

type connectionResultMsg struct {
	client *api.Client
	err    error
}

// checkAllHealth starts health checks for all servers in parallel
func (m *ServerSelectModel) checkAllHealth() tea.Cmd {
	if len(m.servers) == 0 {
		return nil
	}

	// Mark all as checking
	for _, server := range m.servers {
		m.healthStatus[server.ID] = HealthChecking
	}

	// Create commands for all health checks
	cmds := make([]tea.Cmd, len(m.servers))
	for i, server := range m.servers {
		s := server // capture for closure
		cmds[i] = func() tea.Msg {
			var token string
			if s.Token != nil {
				token = *s.Token
			}
			client := api.New(s.URL, token, s.Insecure)
			online := client.IsReachable()
			return healthCheckMsg{serverID: s.ID, online: online}
		}
	}

	return tea.Batch(cmds...)
}

func (m *ServerSelectModel) deleteServer(server *db.Server) tea.Cmd {
	return func() tea.Msg {
		if err := m.db.DeleteServer(server.ID); err != nil {
			return serversLoadedMsg{err: err}
		}
		servers, err := m.db.ListServers()
		return serversLoadedMsg{servers: servers, err: err}
	}
}

func (m *ServerSelectModel) View() string {
	innerWidth := layout.InnerWidth(m.width)
	var b strings.Builder

	// Logo (centered)
	logo := styles.RenderLogo(innerWidth)
	for _, line := range strings.Split(logo, "\n") {
		b.WriteString(layout.CenterText(line, innerWidth) + "\n")
	}

	// Version
	b.WriteString(layout.CenterText(styles.TextMuted.Render("v"+layout.Version), innerWidth) + "\n")

	// Divider
	b.WriteString(layout.Divider(innerWidth) + "\n")

	// Content
	if m.confirmingDelete && m.deleteTarget != nil {
		b.WriteString(m.renderDeleteConfirmation(innerWidth))
	} else if m.err != nil {
		b.WriteString(styles.TextError.Render("Error: "+m.err.Error()) + "\n")
	} else if len(m.servers) == 0 {
		b.WriteString(m.renderEmptyState(innerWidth))
	} else {
		b.WriteString(m.renderServerList(innerWidth))
	}

	// Build footer
	var footer strings.Builder
	footer.WriteString(layout.Divider(innerWidth) + "\n")
	footer.WriteString(m.renderShortcuts())

	return layout.Screen(m.width, m.height, b.String(), footer.String())
}

func (m *ServerSelectModel) renderServerList(width int) string {
	var b strings.Builder
	b.WriteString(styles.SectionTitle.Render("SAVED SERVERS") + "\n")

	for i, server := range m.servers {
		b.WriteString(m.renderServerRow(i, server, width) + "\n")
	}

	return b.String()
}

func (m *ServerSelectModel) renderEmptyState(width int) string {
	var b strings.Builder

	b.WriteString(layout.CenterText(styles.TextMuted.Render("No servers configured yet."), width) + "\n")
	b.WriteString("\n")
	b.WriteString(layout.CenterText(styles.TextMuted.Render("Press 'a' to add your first server"), width) + "\n")
	b.WriteString(layout.CenterText(styles.TextMuted.Render("or connect directly via CLI:"), width) + "\n")
	b.WriteString("\n")
	b.WriteString(layout.CenterText(styles.TextPrimary.Render("buntime --url https://your-server.com"), width) + "\n")

	return b.String()
}

func (m *ServerSelectModel) renderDeleteConfirmation(width int) string {
	var b strings.Builder

	b.WriteString("\n")

	// Card with warning border
	cardStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(styles.ColorWarning).
		Padding(1, 2).
		Width(width - 4)

	var cardContent strings.Builder
	cardContent.WriteString(styles.TextWarning.Bold(true).Render("DELETE SERVER") + "\n\n")
	cardContent.WriteString("Are you sure you want to delete this server?\n\n")
	cardContent.WriteString("  " + styles.TextMuted.Render("Name: ") + m.deleteTarget.Name + "\n")
	cardContent.WriteString("  " + styles.TextMuted.Render("URL: ") + m.deleteTarget.URL + "\n\n")
	cardContent.WriteString(styles.TextError.Render("This action cannot be undone."))

	b.WriteString(cardStyle.Render(cardContent.String()))
	b.WriteString("\n")

	return b.String()
}

func (m *ServerSelectModel) renderShortcuts() string {
	if m.confirmingDelete {
		shortcuts := []string{
			styles.RenderShortcut("y/⏎", "confirm"),
			styles.RenderShortcut("n/Esc", "cancel"),
		}
		return layout.Shortcuts(shortcuts)
	}

	shortcuts := []string{
		styles.RenderShortcut("↑↓", "navigate"),
		styles.RenderShortcut("⏎", "connect"),
		styles.RenderShortcut("a", "add"),
	}

	if len(m.servers) > 0 {
		shortcuts = append(shortcuts,
			styles.RenderShortcut("e", "edit"),
			styles.RenderShortcut("d", "delete"),
		)
	}

	shortcuts = append(shortcuts, styles.RenderShortcut("r", "refresh"))

	return layout.Shortcuts(shortcuts)
}

// Navigation commands
func navigateToAddServer() tea.Cmd {
	return func() tea.Msg {
		return NavigateMsg{Screen: ScreenAddServer, Data: nil}
	}
}

func navigateToTokenPrompt(server *db.Server) tea.Cmd {
	return func() tea.Msg {
		return NavigateMsg{Screen: ScreenTokenPrompt, Data: server}
	}
}

func navigateToEditServer(server *db.Server) tea.Cmd {
	return func() tea.Msg {
		return NavigateMsg{Screen: ScreenEditServer, Data: server}
	}
}

// Navigation message types
type NavigateMsg struct {
	Screen         int
	Data           interface{}
	ReplaceHistory bool // If true, replaces current screen in history instead of pushing
}

const (
	ScreenServerSelect = iota
	ScreenAddServer
	ScreenEditServer
	ScreenTokenPrompt
	ScreenMainMenu
	ScreenApps
	ScreenAppInstall
	ScreenAppRemove
	ScreenPlugins
	ScreenPluginInstall
	ScreenPluginRemove
	ScreenSettings
	ScreenKeys
	ScreenKeyCreate
	ScreenKeyRevoke
)

// Helper functions
func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-3] + "..."
}
