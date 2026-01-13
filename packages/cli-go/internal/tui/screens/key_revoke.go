package screens

import (
	"strings"

	"github.com/buntime/cli/internal/api"
	"github.com/buntime/cli/internal/db"
	"github.com/buntime/cli/internal/tui/layout"
	"github.com/buntime/cli/internal/tui/messages"
	"github.com/buntime/cli/internal/tui/styles"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
)

// KeyRevokeModel handles API key revocation confirmation
type KeyRevokeModel struct {
	api    *api.Client
	server *db.Server
	key    *api.ApiKeyInfo
	width  int
	height int

	confirmInput textinput.Model
	loading      bool
	err          error
}

// NewKeyRevokeModel creates a new key revocation screen
func NewKeyRevokeModel(client *api.Client, server *db.Server, key *api.ApiKeyInfo, width, height int) *KeyRevokeModel {
	ti := textinput.New()
	ti.Placeholder = key.Name
	ti.Prompt = ""
	ti.Focus()
	ti.CharLimit = 64
	ti.Width = 40

	return &KeyRevokeModel{
		api:          client,
		server:       server,
		key:          key,
		width:        width,
		height:       height,
		confirmInput: ti,
	}
}

func (m *KeyRevokeModel) Init() tea.Cmd {
	return textinput.Blink
}

func (m *KeyRevokeModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case keyRevokedMsg:
		m.loading = false
		if msg.err != nil {
			m.err = msg.err
			return m, nil
		}
		// Success - navigate back and show toast
		return m, tea.Batch(
			func() tea.Msg {
				return NavigateMsg{Screen: ScreenKeys, Data: nil, ReplaceHistory: true}
			},
			func() tea.Msg {
				return messages.ShowSuccess("API key deleted successfully")
			},
		)

	case tea.KeyMsg:
		if m.loading {
			return m, nil
		}
		switch msg.String() {
		case "esc":
			// Navigate back to keys list, replacing history
			return m, func() tea.Msg {
				return NavigateMsg{Screen: ScreenKeys, Data: nil, ReplaceHistory: true}
			}
		case "enter":
			if strings.TrimSpace(m.confirmInput.Value()) == m.key.Name {
				return m, m.revokeKey()
			}
		}
	}

	var cmd tea.Cmd
	m.confirmInput, cmd = m.confirmInput.Update(msg)
	return m, cmd
}

func (m *KeyRevokeModel) revokeKey() tea.Cmd {
	m.loading = true
	m.err = nil

	return func() tea.Msg {
		err := m.api.RevokeKey(m.key.ID)
		return keyRevokedMsg{err: err}
	}
}

func (m *KeyRevokeModel) View() string {
	innerWidth := layout.InnerWidth(m.width)

	return layout.Page(layout.PageConfig{
		Width:      m.width,
		Height:     m.height,
		Server:     m.server,
		Breadcrumb: "Main › API Keys › Delete",
		Title:      "DELETE API KEY",
		Content:    m.renderContent(innerWidth),
		Shortcuts:  m.getShortcuts(),
	})
}

func (m *KeyRevokeModel) renderContent(width int) string {
	var b strings.Builder

	// Error
	if m.err != nil {
		b.WriteString(styles.TextError.Render("Error: "+m.err.Error()) + "\n\n")
	}

	b.WriteString(layout.ConfirmModal(layout.ConfirmModalConfig{
		Width:      width - 4,
		Warning:    "You are about to delete the following key:",
		DangerText: "Any systems using this key will lose access immediately.",
		Items: []layout.ConfirmModalItem{
			{Label: "Name", Value: m.key.Name},
			{Label: "Role", Value: string(m.key.Role)},
			{Label: "Prefix", Value: m.key.KeyPrefix + "..."},
		},
		ConfirmWord: m.key.Name,
		InputView:   m.confirmInput.View(),
	}))
	b.WriteString("\n\n")

	if m.loading {
		b.WriteString(styles.TextMuted.Render("Deleting key...") + "\n")
	} else {
		b.WriteString(styles.TextMuted.Render("Press Enter to confirm, Esc to cancel") + "\n")
	}

	return b.String()
}

func (m *KeyRevokeModel) getShortcuts() []string {
	return []string{
		styles.RenderShortcut("⏎", "confirm"),
		styles.RenderShortcut("Esc", "cancel"),
	}
}
