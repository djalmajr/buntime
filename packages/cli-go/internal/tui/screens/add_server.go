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
	focusName = iota
	focusURL
	focusInsecure
	focusCancel
	focusSave
)

// AddServerModel is the add server form screen
type AddServerModel struct {
	db         *db.DB
	nameInput  textinput.Model
	urlInput   textinput.Model
	insecure   bool
	focusIndex int
	width      int
	height     int
	err        string
}

// NewAddServerModel creates a new add server form
func NewAddServerModel(database *db.DB, width, height int) *AddServerModel {
	nameInput := textinput.New()
	nameInput.Placeholder = "Production"
	nameInput.Prompt = ""
	nameInput.CharLimit = 50
	nameInput.Width = 40
	nameInput.Focus()

	urlInput := textinput.New()
	urlInput.Placeholder = "https://buntime.example.com"
	urlInput.Prompt = ""
	urlInput.CharLimit = 200
	urlInput.Width = 40

	return &AddServerModel{
		db:         database,
		nameInput:  nameInput,
		urlInput:   urlInput,
		focusIndex: focusName,
		width:      width,
		height:     height,
	}
}

func (m *AddServerModel) Init() tea.Cmd {
	return textinput.Blink
}

func (m *AddServerModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
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
		case "enter":
			if m.focusIndex == focusSave {
				return m, m.save()
			}
			if m.focusIndex == focusCancel {
				return m, goBack()
			}
			m.focusNext()
			return m, nil
		case " ", "space":
			if m.focusIndex == focusInsecure {
				m.insecure = !m.insecure
				return m, nil
			}
		case "esc":
			return m, goBack()
		}
	}

	// Update focused input
	var cmd tea.Cmd
	if m.focusIndex == focusName {
		m.nameInput, cmd = m.nameInput.Update(msg)
	} else if m.focusIndex == focusURL {
		m.urlInput, cmd = m.urlInput.Update(msg)
	}

	return m, cmd
}

func (m *AddServerModel) focusNext() {
	m.focusIndex = (m.focusIndex + 1) % 5
	m.updateFocus()
}

func (m *AddServerModel) focusPrev() {
	m.focusIndex--
	if m.focusIndex < 0 {
		m.focusIndex = 4
	}
	m.updateFocus()
}

func (m *AddServerModel) updateFocus() {
	m.nameInput.Blur()
	m.urlInput.Blur()

	switch m.focusIndex {
	case focusName:
		m.nameInput.Focus()
	case focusURL:
		m.urlInput.Focus()
	}
}

func (m *AddServerModel) validate() string {
	urlStr := strings.TrimSpace(m.urlInput.Value())

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

	// Check for duplicate
	existing, err := m.db.GetServerByURL(urlStr)
	if err == nil && existing != nil {
		return "Server with this URL already exists: \"" + existing.Name + "\""
	}

	return ""
}

func (m *AddServerModel) save() tea.Cmd {
	if errMsg := m.validate(); errMsg != "" {
		m.err = errMsg
		return nil
	}

	urlStr := strings.TrimSpace(m.urlInput.Value())
	name := strings.TrimSpace(m.nameInput.Value())

	if name == "" {
		name = m.generateName(urlStr)
	}

	return func() tea.Msg {
		server, err := m.db.CreateServer(name, urlStr, nil, m.insecure)
		if err != nil {
			return messages.ServerSavedMsg{Err: err}
		}
		return messages.ServerSavedMsg{Server: server}
	}
}

func (m *AddServerModel) generateName(urlStr string) string {
	parsed, err := url.Parse(urlStr)
	if err != nil {
		return "Server"
	}

	host := parsed.Hostname()
	host = strings.TrimPrefix(host, "www.")
	host = strings.TrimPrefix(host, "api.")
	host = strings.TrimPrefix(host, "buntime.")

	if len(host) > 0 {
		return strings.ToUpper(host[:1]) + host[1:]
	}

	return "Server"
}

func (m *AddServerModel) View() string {
	innerWidth := layout.InnerWidth(m.width)
	var b strings.Builder

	b.WriteString("\n")

	// Title
	b.WriteString(styles.SectionTitle.Render("ADD SERVER") + "\n")
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

func (m *AddServerModel) renderCard(content string, width int) string {
	// Create a card with rounded border
	cardStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(styles.ColorSurface).
		Padding(1, 2).
		Width(width)

	return cardStyle.Render(content)
}

func (m *AddServerModel) renderForm() string {
	var b strings.Builder

	// Name field
	b.WriteString(m.renderLabel("Name", false) + "\n")
	b.WriteString(m.renderInput(m.nameInput, m.focusIndex == focusName, false) + "\n")
	b.WriteString(styles.TextMuted.Italic(true).Render("Auto-generated from hostname if empty") + "\n")
	b.WriteString("\n")

	// URL field
	b.WriteString(m.renderLabel("URL", true) + "\n")
	hasError := m.err != "" && strings.Contains(m.err, "URL")
	b.WriteString(m.renderInput(m.urlInput, m.focusIndex == focusURL, hasError) + "\n")
	if m.err != "" {
		b.WriteString(styles.TextError.Render("✗ "+m.err) + "\n")
	}
	b.WriteString("\n")

	// Insecure checkbox
	b.WriteString(m.renderCheckbox("Skip TLS verification (insecure)", m.insecure, m.focusIndex == focusInsecure) + "\n")
	b.WriteString("\n")

	// Buttons
	b.WriteString(m.renderButtons())

	return b.String()
}

func (m *AddServerModel) renderLabel(text string, required bool) string {
	label := styles.TextNormal.Render(text)
	if required {
		label += styles.TextError.Render(" *")
	}
	return label
}

func (m *AddServerModel) renderInput(input textinput.Model, focused bool, hasError bool) string {
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

func (m *AddServerModel) renderCheckbox(label string, checked bool, focused bool) string {
	checkbox := styles.RenderCheckbox(checked, focused)

	labelStyle := styles.TextNormal
	if focused {
		labelStyle = styles.TextPrimary
	}

	return lipgloss.JoinHorizontal(lipgloss.Center, checkbox, "  ", labelStyle.Render(label))
}

func (m *AddServerModel) renderButtons() string {
	cancelStyle := styles.Button
	if m.focusIndex == focusCancel {
		cancelStyle = styles.ButtonFocused
	}

	saveStyle := styles.Button
	if m.focusIndex == focusSave {
		saveStyle = styles.ButtonPrimary
	}

	cancel := cancelStyle.Render("  Cancel  ")
	save := saveStyle.Render("   Save   ")

	return lipgloss.JoinHorizontal(lipgloss.Center, cancel, "  ", save)
}

func (m *AddServerModel) renderShortcuts() string {
	shortcuts := []string{
		styles.RenderShortcut("Tab", "next"),
		styles.RenderShortcut("Shift+Tab", "prev"),
		styles.RenderShortcut("⏎", "submit"),
		styles.RenderShortcut("Esc", "cancel"),
	}

	return layout.Shortcuts(shortcuts)
}
