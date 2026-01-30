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
	"github.com/charmbracelet/lipgloss"
)

const (
	tokenFocusInput = iota
	tokenFocusSave
	tokenFocusCancel
	tokenFocusConnect
)

// TokenPromptModel prompts for authentication token
type TokenPromptModel struct {
	db         *db.DB
	server     *db.Server
	tokenInput textinput.Model
	saveToken  bool
	focusIndex int
	width      int
	height     int
	err        string
	connecting bool
}

// NewTokenPromptModel creates a token prompt screen
func NewTokenPromptModel(database *db.DB, server *db.Server, width, height int) *TokenPromptModel {
	tokenInput := textinput.New()
	tokenInput.Placeholder = "Enter API key"
	tokenInput.Prompt = ""
	tokenInput.EchoMode = textinput.EchoPassword
	tokenInput.EchoCharacter = '•'
	tokenInput.CharLimit = 500
	tokenInput.Width = 40
	tokenInput.Focus()

	return &TokenPromptModel{
		db:         database,
		server:     server,
		tokenInput: tokenInput,
		saveToken:  true,
		focusIndex: tokenFocusInput,
		width:      width,
		height:     height,
	}
}

func (m *TokenPromptModel) Init() tea.Cmd {
	return textinput.Blink
}

func (m *TokenPromptModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case tea.KeyMsg:
		switch msg.String() {
		case "tab", "down":
			m.focusNext()
			return m, nil
		case "shift+tab", "up":
			m.focusPrev()
			return m, nil
		case "ctrl+r":
			if m.tokenInput.EchoMode == textinput.EchoPassword {
				m.tokenInput.EchoMode = textinput.EchoNormal
			} else {
				m.tokenInput.EchoMode = textinput.EchoPassword
			}
			return m, nil
		case "enter":
			switch m.focusIndex {
			case tokenFocusConnect:
				return m, m.connect()
			case tokenFocusCancel:
				return m, goBack()
			default:
				m.focusNext()
			}
			return m, nil
		case " ", "space":
			if m.focusIndex == tokenFocusSave {
				m.saveToken = !m.saveToken
				return m, nil
			}
		case "esc":
			return m, goBack()
		}

	case tokenConnectResultMsg:
		m.connecting = false
		if msg.err != nil {
			return m, func() tea.Msg {
				return messages.ShowError("Authentication failed: " + msg.err.Error())
			}
		}

		if m.saveToken {
			token := m.tokenInput.Value()
			m.db.UpdateServerToken(m.server.ID, token)
		}

		m.db.TouchServer(m.server.ID)

		return m, func() tea.Msg {
			return ConnectedMsg{Client: msg.client, Server: m.server}
		}
	}

	var cmd tea.Cmd
	if m.focusIndex == tokenFocusInput {
		m.tokenInput, cmd = m.tokenInput.Update(msg)
	}

	return m, cmd
}

func (m *TokenPromptModel) focusNext() {
	m.focusIndex = (m.focusIndex + 1) % 4
	m.updateFocus()
}

func (m *TokenPromptModel) focusPrev() {
	m.focusIndex--
	if m.focusIndex < 0 {
		m.focusIndex = 3
	}
	m.updateFocus()
}

func (m *TokenPromptModel) updateFocus() {
	if m.focusIndex == tokenFocusInput {
		m.tokenInput.Focus()
	} else {
		m.tokenInput.Blur()
	}
}

func (m *TokenPromptModel) connect() tea.Cmd {
	token := strings.TrimSpace(m.tokenInput.Value())
	if token == "" {
		m.err = "API key is required"
		return nil
	}

	m.connecting = true
	m.err = ""

	return func() tea.Msg {
		client := api.New(m.server.URL, token, m.server.Insecure)
		err := client.Ping()
		if err != nil {
			return tokenConnectResultMsg{err: err}
		}
		return tokenConnectResultMsg{client: client}
	}
}

type tokenConnectResultMsg struct {
	client *api.Client
	err    error
}

func (m *TokenPromptModel) View() string {
	innerWidth := layout.InnerWidth(m.width)
	var b strings.Builder

	b.WriteString("\n")

	// Title
	b.WriteString(styles.SectionTitle.Render("AUTHENTICATION REQUIRED") + "\n")
	b.WriteString("\n")

	// Description
	b.WriteString(styles.TextMuted.Render("Server requires API key for authentication.") + "\n")
	b.WriteString(styles.TextMuted.Render("Server: ") + styles.TextPrimary.Render(m.server.Name) + "\n")
	b.WriteString("\n")

	// Form card
	formContent := m.renderForm()
	card := m.renderCard(formContent, innerWidth-4)
	b.WriteString(card)

	// Build footer
	var footer strings.Builder
	footer.WriteString(layout.Divider(innerWidth) + "\n")
	footer.WriteString(m.renderShortcuts())

	return layout.Screen(m.width, m.height, b.String(), footer.String())
}

func (m *TokenPromptModel) renderCard(content string, width int) string {
	cardStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(styles.ColorSurface).
		Padding(1, 2).
		Width(width)

	return cardStyle.Render(content)
}

func (m *TokenPromptModel) renderForm() string {
	var b strings.Builder

	// API Key field
	b.WriteString(m.renderLabel("API Key", true) + "\n")
	hasError := m.err != ""
	b.WriteString(m.renderInput(m.tokenInput, m.focusIndex == tokenFocusInput, hasError) + "\n")
	b.WriteString(styles.TextMuted.Render("Ctrl+R to toggle visibility") + "\n")
	b.WriteString("\n")

	// Error message
	if m.err != "" {
		b.WriteString(styles.TextError.Render("✗ "+m.err) + "\n")
		b.WriteString("\n")
	}

	// Save checkbox
	b.WriteString(m.renderCheckbox("Save API key for this server", m.saveToken, m.focusIndex == tokenFocusSave) + "\n")
	b.WriteString("\n")

	// Buttons
	b.WriteString(m.renderButtons())

	return b.String()
}

func (m *TokenPromptModel) renderLabel(text string, required bool) string {
	label := styles.TextNormal.Render(text)
	if required {
		label += styles.TextError.Render(" *")
	}
	return label
}

func (m *TokenPromptModel) renderInput(input textinput.Model, focused bool, hasError bool) string {
	var borderColor lipgloss.Color
	if hasError {
		borderColor = styles.ColorError
	} else if focused {
		borderColor = styles.ColorPrimary
	} else {
		borderColor = styles.ColorSurface
	}

	inputStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(borderColor).
		Padding(0, 1).
		Width(44)

	return inputStyle.Render(input.View())
}

func (m *TokenPromptModel) renderCheckbox(label string, checked bool, focused bool) string {
	checkbox := styles.RenderCheckbox(checked, focused)

	labelStyle := styles.TextNormal
	if focused {
		labelStyle = styles.TextPrimary
	}

	return lipgloss.JoinHorizontal(lipgloss.Center, checkbox, "  ", labelStyle.Render(label))
}

func (m *TokenPromptModel) renderButtons() string {
	cancelStyle := styles.Button
	if m.focusIndex == tokenFocusCancel {
		cancelStyle = styles.ButtonFocused
	}

	connectStyle := styles.Button
	if m.focusIndex == tokenFocusConnect {
		connectStyle = styles.ButtonPrimary
	}

	connectText := " Connect  "
	if m.connecting {
		connectText = "Connecting..."
	}

	cancel := cancelStyle.Render("  Cancel  ")
	connect := connectStyle.Render(connectText)

	return lipgloss.JoinHorizontal(lipgloss.Center, cancel, "  ", connect)
}

func (m *TokenPromptModel) renderShortcuts() string {
	shortcuts := []string{
		styles.RenderShortcut("Tab", "next"),
		styles.RenderShortcut("Shift+Tab", "prev"),
		styles.RenderShortcut("Ctrl+R", "visibility"),
		styles.RenderShortcut("⏎", "submit"),
		styles.RenderShortcut("Esc", "cancel"),
	}

	return layout.Shortcuts(shortcuts)
}
