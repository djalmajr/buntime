package screens

import (
	"net/url"
	"strings"

	"github.com/buntime/cli/internal/db"
	"github.com/buntime/cli/internal/tui/layout"
	"github.com/buntime/cli/internal/tui/messages"
	"github.com/buntime/cli/internal/tui/styles"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

const (
	editFocusName = iota
	editFocusURL
	editFocusToken
	editFocusInsecure
	editFocusCancel
	editFocusSave
)

// EditServerModel is the edit server form screen
type EditServerModel struct {
	db         *db.DB
	server     *db.Server
	nameInput  textinput.Model
	urlInput   textinput.Model
	tokenInput textinput.Model
	insecure   bool
	focusIndex int
	width      int
	height     int
	err        string
}

// NewEditServerModel creates an edit server form
func NewEditServerModel(database *db.DB, server *db.Server, width, height int) *EditServerModel {
	nameInput := textinput.New()
	nameInput.SetValue(server.Name)
	nameInput.Prompt = ""
	nameInput.CharLimit = 50
	nameInput.Width = 40
	nameInput.Focus()

	urlInput := textinput.New()
	urlInput.SetValue(server.URL)
	urlInput.Prompt = ""
	urlInput.CharLimit = 200
	urlInput.Width = 40

	tokenInput := textinput.New()
	if server.Token != nil {
		tokenInput.SetValue(*server.Token)
	}
	tokenInput.Placeholder = "Leave empty to keep current"
	tokenInput.Prompt = ""
	tokenInput.EchoMode = textinput.EchoPassword
	tokenInput.EchoCharacter = '•'
	tokenInput.CharLimit = 500
	tokenInput.Width = 100 // Large enough to avoid wrapping

	return &EditServerModel{
		db:         database,
		server:     server,
		nameInput:  nameInput,
		urlInput:   urlInput,
		tokenInput: tokenInput,
		insecure:   server.Insecure,
		focusIndex: editFocusName,
		width:      width,
		height:     height,
	}
}

func (m *EditServerModel) Init() tea.Cmd {
	return textinput.Blink
}

func (m *EditServerModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
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
			if m.focusIndex == editFocusSave {
				return m, m.save()
			}
			if m.focusIndex == editFocusCancel {
				return m, goBack()
			}
			m.focusNext()
			return m, nil
		case " ", "space":
			if m.focusIndex == editFocusInsecure {
				m.insecure = !m.insecure
				return m, nil
			}
		case "esc":
			return m, goBack()
		}
	}

	// Update focused input
	var cmd tea.Cmd
	switch m.focusIndex {
	case editFocusName:
		m.nameInput, cmd = m.nameInput.Update(msg)
	case editFocusURL:
		m.urlInput, cmd = m.urlInput.Update(msg)
	case editFocusToken:
		m.tokenInput, cmd = m.tokenInput.Update(msg)
	}

	return m, cmd
}

func (m *EditServerModel) focusNext() {
	m.focusIndex = (m.focusIndex + 1) % 6
	m.updateFocus()
}

func (m *EditServerModel) focusPrev() {
	m.focusIndex--
	if m.focusIndex < 0 {
		m.focusIndex = 5
	}
	m.updateFocus()
}

func (m *EditServerModel) updateFocus() {
	m.nameInput.Blur()
	m.urlInput.Blur()
	m.tokenInput.Blur()

	switch m.focusIndex {
	case editFocusName:
		m.nameInput.Focus()
	case editFocusURL:
		m.urlInput.Focus()
	case editFocusToken:
		m.tokenInput.Focus()
	}
}

func (m *EditServerModel) validate() string {
	urlStr := strings.TrimSpace(m.urlInput.Value())
	name := strings.TrimSpace(m.nameInput.Value())

	if name == "" {
		return "Name is required"
	}

	if urlStr == "" {
		return "URL is required"
	}

	if !strings.HasPrefix(urlStr, "http://") && !strings.HasPrefix(urlStr, "https://") {
		return "URL must start with http:// or https://"
	}

	parsed, err := url.Parse(urlStr)
	if err != nil {
		return "Invalid URL format"
	}

	if parsed.Host == "" {
		return "URL must include a hostname"
	}

	if urlStr != m.server.URL {
		existing, err := m.db.GetServerByURL(urlStr)
		if err == nil && existing != nil {
			return "Server with this URL already exists: \"" + existing.Name + "\""
		}
	}

	return ""
}

func (m *EditServerModel) save() tea.Cmd {
	if errMsg := m.validate(); errMsg != "" {
		m.err = errMsg
		return nil
	}

	urlStr := strings.TrimSpace(m.urlInput.Value())
	name := strings.TrimSpace(m.nameInput.Value())
	tokenStr := strings.TrimSpace(m.tokenInput.Value())

	var token *string
	if tokenStr != "" {
		token = &tokenStr
	} else if m.server.Token != nil {
		token = m.server.Token
	}

	return func() tea.Msg {
		err := m.db.UpdateServer(m.server.ID, name, urlStr, token, m.insecure)
		if err != nil {
			return messages.ServerSavedMsg{Err: err}
		}
		server, _ := m.db.GetServer(m.server.ID)
		return messages.ServerSavedMsg{Server: server}
	}
}

func (m *EditServerModel) View() string {
	innerWidth := layout.InnerWidth(m.width)
	var b strings.Builder

	b.WriteString("\n")

	// Title
	b.WriteString(styles.SectionTitle.Render("EDIT SERVER") + "\n")
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

func (m *EditServerModel) renderCard(content string, width int) string {
	cardStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(styles.ColorSurface).
		Padding(1, 2).
		Width(width)

	return cardStyle.Render(content)
}

func (m *EditServerModel) renderForm() string {
	var b strings.Builder

	// Name field
	b.WriteString(m.renderLabel("Name", true) + "\n")
	b.WriteString(m.renderInput(m.nameInput, m.focusIndex == editFocusName, false) + "\n")
	b.WriteString("\n")

	// URL field
	b.WriteString(m.renderLabel("URL", true) + "\n")
	hasURLError := m.err != "" && strings.Contains(m.err, "URL")
	b.WriteString(m.renderInput(m.urlInput, m.focusIndex == editFocusURL, hasURLError) + "\n")
	b.WriteString("\n")

	// Token field
	b.WriteString(m.renderLabel("Token", false) + "\n")
	b.WriteString(m.renderInput(m.tokenInput, m.focusIndex == editFocusToken, false) + "\n")
	b.WriteString(styles.TextMuted.Render("Ctrl+R to toggle visibility") + "\n")
	b.WriteString("\n")

	// Error message
	if m.err != "" {
		b.WriteString(styles.TextError.Render("✗ "+m.err) + "\n")
		b.WriteString("\n")
	}

	// Insecure checkbox
	b.WriteString(m.renderCheckbox("Skip TLS verification (insecure)", m.insecure, m.focusIndex == editFocusInsecure) + "\n")
	b.WriteString("\n")

	// Buttons
	b.WriteString(m.renderButtons())

	return b.String()
}

func (m *EditServerModel) renderLabel(text string, required bool) string {
	label := styles.TextNormal.Render(text)
	if required {
		label += styles.TextError.Render(" *")
	}
	return label
}

func (m *EditServerModel) renderInput(input textinput.Model, focused bool, hasError bool) string {
	var borderColor lipgloss.Color
	if hasError {
		borderColor = styles.ColorError
	} else if focused {
		borderColor = styles.ColorPrimary
	} else {
		borderColor = styles.ColorSurface
	}

	// Get the input view and truncate if necessary to prevent wrapping
	inputView := input.View()
	maxVisibleWidth := 40
	if lipgloss.Width(inputView) > maxVisibleWidth {
		// Truncate to prevent overflow (textinput should scroll, not wrap)
		runes := []rune(inputView)
		for len(runes) > 0 && lipgloss.Width(string(runes)) > maxVisibleWidth {
			runes = runes[:len(runes)-1]
		}
		inputView = string(runes)
	}

	inputStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(borderColor).
		Padding(0, 1).
		Width(44)

	return inputStyle.Render(inputView)
}

func (m *EditServerModel) renderCheckbox(label string, checked bool, focused bool) string {
	checkbox := styles.RenderCheckbox(checked, focused)

	labelStyle := styles.TextNormal
	if focused {
		labelStyle = styles.TextPrimary
	}

	return lipgloss.JoinHorizontal(lipgloss.Center, checkbox, "  ", labelStyle.Render(label))
}

func (m *EditServerModel) renderButtons() string {
	cancelStyle := styles.Button
	if m.focusIndex == editFocusCancel {
		cancelStyle = styles.ButtonFocused
	}

	saveStyle := styles.Button
	if m.focusIndex == editFocusSave {
		saveStyle = styles.ButtonPrimary
	}

	cancel := cancelStyle.Render("  Cancel  ")
	save := saveStyle.Render("   Save   ")

	return lipgloss.JoinHorizontal(lipgloss.Center, cancel, "  ", save)
}

func (m *EditServerModel) renderShortcuts() string {
	shortcuts := []string{
		styles.RenderShortcut("Tab", "next"),
		styles.RenderShortcut("Shift+Tab", "prev"),
		styles.RenderShortcut("⏎", "submit"),
		styles.RenderShortcut("Esc", "cancel"),
	}

	return layout.Shortcuts(shortcuts)
}
