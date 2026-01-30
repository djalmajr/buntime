package screens

import (
	"fmt"
	"strings"
	"time"

	"github.com/buntime/cli/internal/api"
	"github.com/buntime/cli/internal/db"
	"github.com/buntime/cli/internal/tui/layout"
	"github.com/buntime/cli/internal/tui/styles"
	tea "github.com/charmbracelet/bubbletea"
)

// KeysModel shows the API keys list
type KeysModel struct {
	api     *api.Client
	server  *db.Server
	keys    []api.ApiKeyInfo
	cursor  int
	width   int
	height  int
	loading bool
	err     error
}

// NewKeysModel creates an API keys list screen
func NewKeysModel(client *api.Client, server *db.Server, width, height int) *KeysModel {
	return &KeysModel{
		api:     client,
		server:  server,
		width:   width,
		height:  height,
		loading: true,
	}
}

func (m *KeysModel) Init() tea.Cmd {
	return m.loadKeys()
}

func (m *KeysModel) loadKeys() tea.Cmd {
	return func() tea.Msg {
		keys, err := m.api.ListKeys()
		if err != nil {
			return keysLoadedMsg{err: err}
		}
		return keysLoadedMsg{keys: keys}
	}
}

type keysLoadedMsg struct {
	keys []api.ApiKeyInfo
	err  error
}

func (m *KeysModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case keysLoadedMsg:
		m.loading = false
		if msg.err != nil {
			m.err = msg.err
			return m, nil
		}
		m.keys = msg.keys
		return m, nil

	case keyRevokedMsg:
		if msg.err != nil {
			m.err = msg.err
			return m, nil
		}
		m.loading = true
		return m, m.loadKeys()

	case tea.KeyMsg:
		switch msg.String() {
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "down", "j":
			if m.cursor < len(m.keys)-1 {
				m.cursor++
			}
		case "a":
			return m, func() tea.Msg {
				return NavigateMsg{Screen: ScreenKeyCreate, Data: nil}
			}
		case "d":
			if len(m.keys) > 0 && m.cursor < len(m.keys) {
				return m, func() tea.Msg {
					return NavigateMsg{Screen: ScreenKeyRevoke, Data: &m.keys[m.cursor]}
				}
			}
		case "r":
			m.loading = true
			return m, m.loadKeys()
		case "esc":
			return m, goBack()
		}
	}

	return m, nil
}

type keyRevokedMsg struct {
	err error
}

func (m *KeysModel) View() string {
	innerWidth := layout.InnerWidth(m.width)

	titleText := "API KEYS"
	if !m.loading {
		titleText += fmt.Sprintf(" (%d)", len(m.keys))
	}

	var content strings.Builder
	if m.loading {
		content.WriteString(styles.TextMuted.Render("Loading...") + "\n")
	} else if m.err != nil {
		content.WriteString(styles.TextError.Render("Error: "+m.err.Error()) + "\n")
	} else if len(m.keys) == 0 {
		content.WriteString(m.renderEmptyState(innerWidth))
	} else {
		content.WriteString(m.renderKeyList(innerWidth))
	}

	return layout.Page(layout.PageConfig{
		Width:      m.width,
		Height:     m.height,
		Server:     m.server,
		Breadcrumb: "Main › API Keys",
		Title:      titleText,
		Content:    content.String(),
		Shortcuts:  m.getShortcuts(),
	})
}

func (m *KeysModel) renderKeyList(width int) string {
	var b strings.Builder

	// Column widths (adjusted to fit better)
	nameWidth := 20
	roleWidth := 10
	prefixWidth := 20
	lastUsedWidth := 12

	// Header
	headerLine := fmt.Sprintf("  %-*s %-*s %-*s %-*s",
		nameWidth, "NAME",
		roleWidth, "ROLE",
		prefixWidth, "PREFIX",
		lastUsedWidth, "LAST USED",
	)
	b.WriteString(styles.TextMuted.Render(headerLine) + "\n")
	b.WriteString(styles.TextMuted.Render(strings.Repeat("─", width-2)) + "\n")

	// Rows
	for i, key := range m.keys {
		cursor := "  "
		if i == m.cursor {
			cursor = styles.Caret
		}

		lastUsed := "never"
		if key.LastUsedAt != nil {
			lastUsed = formatTimeAgo(*key.LastUsedAt)
		}

		name := truncateKey(key.Name, nameWidth)
		prefix := truncateKey(key.KeyPrefix+"...", prefixWidth)

		line := fmt.Sprintf("%-*s %-*s %-*s %-*s",
			nameWidth, name,
			roleWidth, string(key.Role),
			prefixWidth, prefix,
			lastUsedWidth, lastUsed,
		)

		if i == m.cursor {
			line = styles.TextPrimary.Render(line)
		}

		b.WriteString(cursor + line + "\n")
	}

	return b.String()
}

func (m *KeysModel) renderEmptyState(width int) string {
	var b strings.Builder

	b.WriteString(layout.CenterText(styles.TextMuted.Render("No API keys created yet."), width) + "\n")
	b.WriteString("\n")
	b.WriteString(layout.CenterText(styles.TextMuted.Render("Press 'n' to create your first API key."), width) + "\n")

	return b.String()
}

func (m *KeysModel) getShortcuts() []string {
	shortcuts := []string{
		styles.RenderShortcut("↑↓", "navigate"),
		styles.RenderShortcut("a", "add"),
	}

	if len(m.keys) > 0 {
		shortcuts = append(shortcuts, styles.RenderShortcut("d", "delete"))
	}

	shortcuts = append(shortcuts,
		styles.RenderShortcut("r", "refresh"),
		styles.RenderShortcut("Esc", "back"),
	)

	return shortcuts
}

func formatTimeAgo(timestamp int64) string {
	t := time.Unix(timestamp, 0)
	diff := time.Since(t)

	if diff < time.Minute {
		return "just now"
	}
	if diff < time.Hour {
		mins := int(diff.Minutes())
		if mins == 1 {
			return "1 min ago"
		}
		return fmt.Sprintf("%d mins ago", mins)
	}
	if diff < 24*time.Hour {
		hours := int(diff.Hours())
		if hours == 1 {
			return "1 hour ago"
		}
		return fmt.Sprintf("%d hours ago", hours)
	}
	if diff < 7*24*time.Hour {
		days := int(diff.Hours() / 24)
		if days == 1 {
			return "1 day ago"
		}
		return fmt.Sprintf("%d days ago", days)
	}

	return t.Format("2006-01-02")
}

func truncateKey(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-3] + "..."
}
