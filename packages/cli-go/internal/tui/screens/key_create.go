package screens

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/atotto/clipboard"
	"github.com/buntime/cli/internal/api"
	"github.com/buntime/cli/internal/db"
	"github.com/buntime/cli/internal/tui/layout"
	"github.com/buntime/cli/internal/tui/styles"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Focus indices
const (
	keyFocusName = iota
	keyFocusRole // Role selection (left/right to change)
	keyFocusPermissions
	keyFocusExpiration // Expiration selection (left/right to change)
	keyFocusExpInput
	keyFocusCancel
	keyFocusCreate
)

type roleOption struct {
	role        api.KeyRole
	label       string
	description string
}

var roleOptions = []roleOption{
	{api.KeyRoleAdmin, "Admin", "Full access + manage keys"},
	{api.KeyRoleEditor, "Editor", "Manage plugins/apps"},
	{api.KeyRoleViewer, "Viewer", "Read-only access"},
	{api.KeyRoleCustom, "Custom", "Select specific permissions"},
}

type expirationPreset struct {
	value string
	label string
}

var expirationPresets = []expirationPreset{
	{"never", "Never"},
	{"30d", "30 days"},
	{"90d", "90 days"},
	{"1y", "1 year"},
	{"custom", "Custom"},
}

var allPermissions = []api.Permission{
	api.PermPluginsRead,
	api.PermPluginsInstall,
	api.PermPluginsRemove,
	api.PermPluginsConfig,
	api.PermAppsRead,
	api.PermAppsInstall,
	api.PermAppsRemove,
	api.PermKeysRead,
	api.PermKeysCreate,
	api.PermKeysRevoke,
	api.PermWorkersRead,
	api.PermWorkersRestart,
}

// KeyCreateModel handles API key creation in a single form
type KeyCreateModel struct {
	api    *api.Client
	server *db.Server
	width  int
	height int

	nameInput       textinput.Model
	expirationInput textinput.Model
	roleIndex       int
	expirationIndex int
	permissions     map[api.Permission]bool
	permIndex       int // Current permission cursor (0 to len(allPermissions)-1)
	focusIndex      int

	loading bool
	err     error
	result  *api.CreateKeyResult
	copied  bool
}

// NewKeyCreateModel creates a new key creation screen
func NewKeyCreateModel(client *api.Client, server *db.Server, width, height int) *KeyCreateModel {
	nameInput := textinput.New()
	nameInput.Placeholder = "e.g., Deploy CI/CD"
	nameInput.Prompt = ""
	nameInput.Focus()
	nameInput.CharLimit = 64
	nameInput.Width = 40

	expInput := textinput.New()
	expInput.Placeholder = "e.g., 1y 2m 15d"
	expInput.Prompt = ""
	expInput.CharLimit = 32
	expInput.Width = 20

	return &KeyCreateModel{
		api:             client,
		server:          server,
		width:           width,
		height:          height,
		nameInput:       nameInput,
		expirationInput: expInput,
		roleIndex:       1, // Default to Editor
		expirationIndex: 3, // Default to 1 year
		permissions:     make(map[api.Permission]bool),
		permIndex:       0,
		focusIndex:      keyFocusName,
	}
}

func (m *KeyCreateModel) Init() tea.Cmd {
	return textinput.Blink
}

func (m *KeyCreateModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	// Success screen handling
	if m.result != nil {
		switch msg := msg.(type) {
		case tea.KeyMsg:
			switch msg.String() {
			case "c":
				if err := clipboard.WriteAll(m.result.Key); err == nil {
					m.copied = true
				}
			case "enter", "esc":
				return m, func() tea.Msg {
					return NavigateMsg{Screen: ScreenKeys, Data: nil, ReplaceHistory: true}
				}
			}
		}
		return m, nil
	}

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case keyCreatedMsg:
		m.loading = false
		if msg.err != nil {
			m.err = msg.err
			return m, nil
		}
		m.result = msg.result
		return m, nil

	case tea.KeyMsg:
		if m.loading {
			return m, nil
		}
		switch msg.String() {
		case "esc":
			return m, goBack()
		case "tab":
			return m.focusNext()
		case "shift+tab":
			return m.focusPrev()
		case "up":
			return m.handleUp()
		case "down":
			return m.handleDown()
		case "left":
			return m.handleLeft()
		case "right":
			return m.handleRight()
		case "h", "j", "k", "l":
			// Vim-style navigation only when not in text input
			if m.focusIndex != keyFocusName && m.focusIndex != keyFocusExpInput {
				switch msg.String() {
				case "k":
					return m.handleUp()
				case "j":
					return m.handleDown()
				case "h":
					return m.handleLeft()
				case "l":
					return m.handleRight()
				}
			}
		case "enter":
			return m.handleEnter()
		case " ":
			// Only handle space for permissions toggle, not in text inputs
			if m.focusIndex == keyFocusPermissions {
				return m.handleSpace()
			}
		}
	}

	// Update focused input
	var cmd tea.Cmd
	switch m.focusIndex {
	case keyFocusName:
		m.nameInput, cmd = m.nameInput.Update(msg)
	case keyFocusExpInput:
		m.expirationInput, cmd = m.expirationInput.Update(msg)
	}

	return m, cmd
}

func (m *KeyCreateModel) focusNext() (tea.Model, tea.Cmd) {
	m.blurInputs()

	switch m.focusIndex {
	case keyFocusName:
		m.focusIndex = keyFocusRole
	case keyFocusRole:
		if m.roleIndex == 3 { // Custom role
			m.focusIndex = keyFocusPermissions
		} else {
			m.focusIndex = keyFocusExpiration
		}
	case keyFocusPermissions:
		m.focusIndex = keyFocusExpiration
	case keyFocusExpiration:
		if m.expirationIndex == 4 { // Custom expiration
			m.focusIndex = keyFocusExpInput
		} else {
			m.focusIndex = keyFocusCancel
		}
	case keyFocusExpInput:
		m.focusIndex = keyFocusCancel
	case keyFocusCancel:
		m.focusIndex = keyFocusCreate
	case keyFocusCreate:
		m.focusIndex = keyFocusName // Wrap around
	}

	m.updateInputFocus()
	return m, nil
}

func (m *KeyCreateModel) focusPrev() (tea.Model, tea.Cmd) {
	m.blurInputs()

	switch m.focusIndex {
	case keyFocusName:
		m.focusIndex = keyFocusCreate // Wrap around
	case keyFocusRole:
		m.focusIndex = keyFocusName
	case keyFocusPermissions:
		m.focusIndex = keyFocusRole
	case keyFocusExpiration:
		if m.roleIndex == 3 {
			m.focusIndex = keyFocusPermissions
		} else {
			m.focusIndex = keyFocusRole
		}
	case keyFocusExpInput:
		m.focusIndex = keyFocusExpiration
	case keyFocusCancel:
		if m.expirationIndex == 4 {
			m.focusIndex = keyFocusExpInput
		} else {
			m.focusIndex = keyFocusExpiration
		}
	case keyFocusCreate:
		m.focusIndex = keyFocusCancel
	}

	m.updateInputFocus()
	return m, nil
}

func (m *KeyCreateModel) blurInputs() {
	m.nameInput.Blur()
	m.expirationInput.Blur()
}

func (m *KeyCreateModel) updateInputFocus() {
	switch m.focusIndex {
	case keyFocusName:
		m.nameInput.Focus()
	case keyFocusExpInput:
		m.expirationInput.Focus()
	}
}

func (m *KeyCreateModel) handleUp() (tea.Model, tea.Cmd) {
	if m.focusIndex == keyFocusPermissions {
		if m.permIndex > 0 {
			m.permIndex--
		}
	}
	return m, nil
}

func (m *KeyCreateModel) handleDown() (tea.Model, tea.Cmd) {
	if m.focusIndex == keyFocusPermissions {
		if m.permIndex < len(allPermissions)-1 {
			m.permIndex++
		}
	}
	return m, nil
}

func (m *KeyCreateModel) handleLeft() (tea.Model, tea.Cmd) {
	switch m.focusIndex {
	case keyFocusRole:
		if m.roleIndex > 0 {
			m.roleIndex--
		}
	case keyFocusExpiration:
		if m.expirationIndex > 0 {
			m.expirationIndex--
		}
	}
	return m, nil
}

func (m *KeyCreateModel) handleRight() (tea.Model, tea.Cmd) {
	switch m.focusIndex {
	case keyFocusRole:
		if m.roleIndex < len(roleOptions)-1 {
			m.roleIndex++
		}
	case keyFocusExpiration:
		if m.expirationIndex < len(expirationPresets)-1 {
			m.expirationIndex++
		}
	}
	return m, nil
}

func (m *KeyCreateModel) handleSpace() (tea.Model, tea.Cmd) {
	if m.focusIndex == keyFocusPermissions {
		perm := allPermissions[m.permIndex]
		m.permissions[perm] = !m.permissions[perm]
	}
	return m, nil
}

func (m *KeyCreateModel) handleEnter() (tea.Model, tea.Cmd) {
	switch m.focusIndex {
	case keyFocusName, keyFocusExpInput:
		// Move to next field
		return m.focusNext()
	case keyFocusPermissions:
		// Toggle permission
		return m.handleSpace()
	case keyFocusCancel:
		return m, goBack()
	case keyFocusCreate:
		return m, m.submit()
	default:
		// For role/expiration, move to next field
		return m.focusNext()
	}
}

func (m *KeyCreateModel) validate() string {
	name := strings.TrimSpace(m.nameInput.Value())
	if name == "" {
		return "Name is required"
	}

	// Validate custom expiration
	if m.expirationIndex == 4 {
		expStr := strings.TrimSpace(m.expirationInput.Value())
		if expStr == "" {
			return "Custom expiration is required"
		}
		if _, err := parseDuration(expStr); err != nil {
			return err.Error()
		}
	}

	// Validate custom role has permissions
	if m.roleIndex == 3 {
		count := 0
		for _, enabled := range m.permissions {
			if enabled {
				count++
			}
		}
		if count == 0 {
			return "Select at least one permission for custom role"
		}
	}

	return ""
}

func (m *KeyCreateModel) submit() tea.Cmd {
	if errMsg := m.validate(); errMsg != "" {
		m.err = fmt.Errorf("%s", errMsg)
		return nil
	}

	m.loading = true
	m.err = nil

	return func() tea.Msg {
		var perms []api.Permission
		if roleOptions[m.roleIndex].role == api.KeyRoleCustom {
			for p, enabled := range m.permissions {
				if enabled {
					perms = append(perms, p)
				}
			}
		}

		// Get expiration value
		var expiresIn string
		if m.expirationIndex == 4 {
			// Parse and normalize to days
			normalized, _ := parseDuration(strings.TrimSpace(m.expirationInput.Value()))
			expiresIn = normalized
		} else {
			expiresIn = expirationPresets[m.expirationIndex].value
		}

		input := api.CreateKeyInput{
			Name:        strings.TrimSpace(m.nameInput.Value()),
			Role:        roleOptions[m.roleIndex].role,
			ExpiresIn:   expiresIn,
			Permissions: perms,
		}

		result, err := m.api.CreateKey(input)
		return keyCreatedMsg{result: result, err: err}
	}
}

type keyCreatedMsg struct {
	result *api.CreateKeyResult
	err    error
}

func (m *KeyCreateModel) View() string {
	innerWidth := layout.InnerWidth(m.width)

	// Success screen
	if m.result != nil {
		return m.renderSuccess(innerWidth)
	}

	return layout.Page(layout.PageConfig{
		Width:      m.width,
		Height:     m.height,
		Server:     m.server,
		Breadcrumb: "Main › API Keys › Create",
		Title:      "CREATE API KEY",
		Content:    m.renderForm(innerWidth),
		Shortcuts:  m.getShortcuts(),
	})
}

func (m *KeyCreateModel) renderForm(width int) string {
	var b strings.Builder

	// Error message
	if m.err != nil {
		b.WriteString(styles.TextError.Render("✗ "+m.err.Error()) + "\n\n")
	}

	// Form card
	cardContent := m.renderFormContent()
	b.WriteString(layout.Card(layout.CardConfig{
		Width:   width - 4,
		Variant: layout.CardDefault,
		Content: cardContent,
	}))

	return b.String()
}

func (m *KeyCreateModel) renderFormContent() string {
	var b strings.Builder

	// Name field
	b.WriteString(m.renderLabel("Name", true) + "\n")
	b.WriteString(styles.RenderInput(m.nameInput.View(), m.focusIndex == keyFocusName, false) + "\n\n")

	// Role field
	b.WriteString(m.renderLabel("Role", false))
	if m.focusIndex == keyFocusRole {
		b.WriteString(styles.TextMuted.Render("  ←→ to change"))
	}
	b.WriteString("\n")
	b.WriteString(m.renderRoleOptions() + "\n")
	if m.roleIndex < len(roleOptions) {
		b.WriteString(styles.TextMuted.Render("  "+roleOptions[m.roleIndex].description) + "\n")
	}
	b.WriteString("\n")

	// Permissions (only if custom role)
	if m.roleIndex == 3 {
		b.WriteString(m.renderLabel("Permissions", false))
		if m.focusIndex == keyFocusPermissions {
			b.WriteString(styles.TextMuted.Render("  ↑↓ navigate, Space toggle"))
		}
		b.WriteString("\n")
		b.WriteString(m.renderPermissions() + "\n")
	}

	// Expiration field
	b.WriteString(m.renderLabel("Expiration", false))
	if m.focusIndex == keyFocusExpiration {
		b.WriteString(styles.TextMuted.Render("  ←→ to change"))
	}
	b.WriteString("\n")
	b.WriteString(m.renderExpirationOptions() + "\n")

	// Custom expiration input
	if m.expirationIndex == 4 {
		expValue := strings.TrimSpace(m.expirationInput.Value())
		hasExpError := false
		expErrorMsg := ""
		totalDays := 0
		if expValue != "" {
			if days, err := parseDuration(expValue); err != nil {
				hasExpError = true
				expErrorMsg = err.Error()
			} else {
				// Extract days number from "Xd" format
				fmt.Sscanf(days, "%dd", &totalDays)
			}
		}

		// Input with calculated days on the right
		inputView := styles.RenderInput(m.expirationInput.View(), m.focusIndex == keyFocusExpInput, hasExpError)
		if totalDays > 0 {
			daysText := styles.TextSuccess.Render(fmt.Sprintf("= %d days", totalDays))
			inputView = lipgloss.JoinHorizontal(lipgloss.Center, inputView, "  ", daysText)
		}
		b.WriteString(inputView + "\n")

		if hasExpError {
			b.WriteString(styles.TextError.Render("  "+expErrorMsg) + "\n")
		} else {
			b.WriteString(styles.TextMuted.Render("  Formats: 7d, 2w, 6m, 1y") + "\n")
		}
	}

	// Buttons
	b.WriteString("\n")
	b.WriteString(m.renderButtons())

	return b.String()
}

func (m *KeyCreateModel) renderButtons() string {
	cancelStyle := styles.Button
	if m.focusIndex == keyFocusCancel {
		cancelStyle = styles.ButtonFocused
	}

	createStyle := styles.Button
	if m.focusIndex == keyFocusCreate {
		createStyle = styles.ButtonPrimary
	}

	cancel := cancelStyle.Render("  Cancel  ")
	create := createStyle.Render("  Create  ")

	return lipgloss.JoinHorizontal(lipgloss.Center, cancel, "  ", create)
}

func (m *KeyCreateModel) renderLabel(text string, required bool) string {
	label := styles.TextNormal.Render(text)
	if required {
		label += styles.TextError.Render(" *")
	}
	return label
}

func (m *KeyCreateModel) renderRoleOptions() string {
	var parts []string
	for i, opt := range roleOptions {
		indicator := "○"
		style := styles.TextNormal
		if i == m.roleIndex {
			indicator = "●"
			style = styles.TextPrimary
		}
		parts = append(parts, style.Render(indicator+" "+opt.label))
	}
	return "  " + strings.Join(parts, "   ")
}

func (m *KeyCreateModel) renderExpirationOptions() string {
	var parts []string
	for i, opt := range expirationPresets {
		indicator := "○"
		style := styles.TextNormal
		if i == m.expirationIndex {
			indicator = "●"
			style = styles.TextPrimary
		}
		parts = append(parts, style.Render(indicator+" "+opt.label))
	}
	return "  " + strings.Join(parts, "   ")
}

func (m *KeyCreateModel) renderPermissions() string {
	var b strings.Builder

	// Render in 2 columns
	cols := 2
	rows := (len(allPermissions) + cols - 1) / cols
	colWidth := 28

	for row := 0; row < rows; row++ {
		var rowParts []string
		for col := 0; col < cols; col++ {
			idx := row + col*rows
			if idx >= len(allPermissions) {
				rowParts = append(rowParts, strings.Repeat(" ", colWidth))
				continue
			}

			perm := allPermissions[idx]
			isFocused := m.focusIndex == keyFocusPermissions && idx == m.permIndex
			isChecked := m.permissions[perm]

			checkbox := "[ ]"
			if isChecked {
				checkbox = "[x]"
			}

			label := string(perm)
			style := styles.TextNormal
			if isFocused {
				style = styles.TextPrimary
				if isChecked {
					checkbox = styles.TextSuccess.Render("[x]")
				}
			} else if isChecked {
				style = styles.TextSuccess
			}

			item := checkbox + " " + style.Render(label)
			// Pad to column width
			itemWidth := lipgloss.Width(item)
			if itemWidth < colWidth {
				item += strings.Repeat(" ", colWidth-itemWidth)
			}
			rowParts = append(rowParts, item)
		}
		b.WriteString("  " + strings.Join(rowParts, " ") + "\n")
	}

	return b.String()
}

func (m *KeyCreateModel) renderSuccess(width int) string {
	var content strings.Builder

	content.WriteString(layout.CenterText(styles.TextSuccess.Bold(true).Render("✓ API KEY CREATED"), width) + "\n\n")

	warning := styles.TextMuted.Render("Copy this key now. You won't be able to see it again!") + "\n\n" +
		styles.BoldWarning.Render(m.result.Key)
	content.WriteString(layout.Card(layout.CardConfig{
		Width:   width - 4,
		Variant: layout.CardWarning,
		Content: warning,
	}))
	content.WriteString("\n\n")

	content.WriteString(styles.TextMuted.Render("Name: ") + m.result.Name + "\n")
	content.WriteString(styles.TextMuted.Render("Role: ") + string(m.result.Role) + "\n")
	if m.copied {
		content.WriteString("\n" + styles.TextSuccess.Render("Copied to clipboard!") + "\n")
	}

	return layout.Page(layout.PageConfig{
		Width:      m.width,
		Height:     m.height,
		Server:     m.server,
		Breadcrumb: "Main › API Keys › Create",
		Title:      "CREATE API KEY",
		Content:    content.String(),
		Shortcuts: []string{
			styles.RenderShortcut("c", "copy"),
			styles.RenderShortcut("⏎", "done"),
			styles.RenderShortcut("Esc", "back"),
		},
	})
}

func (m *KeyCreateModel) getShortcuts() []string {
	return []string{
		styles.RenderShortcut("Tab", "next"),
		styles.RenderShortcut("⏎", "submit"),
		styles.RenderShortcut("Esc", "cancel"),
	}
}

// parseDuration parses flexible duration strings like "1y 2m 15d" or "30d"
// Returns the normalized duration string for the API (e.g., "450d")
func parseDuration(s string) (string, error) {
	s = strings.TrimSpace(strings.ToLower(s))
	if s == "" {
		return "", fmt.Errorf("duration cannot be empty")
	}

	// Regex to match duration parts: number followed by unit
	re := regexp.MustCompile(`(\d+)\s*(d|w|m|y|day|days|week|weeks|month|months|year|years)`)
	matches := re.FindAllStringSubmatch(s, -1)

	if len(matches) == 0 {
		return "", fmt.Errorf("invalid format. Use: 7d, 2w, 6m, 1y")
	}

	var totalDays int

	for _, match := range matches {
		num, err := strconv.Atoi(match[1])
		if err != nil {
			return "", fmt.Errorf("invalid number: %s", match[1])
		}

		unit := match[2]
		switch {
		case unit == "d" || unit == "day" || unit == "days":
			totalDays += num
		case unit == "w" || unit == "week" || unit == "weeks":
			totalDays += num * 7
		case unit == "m" || unit == "month" || unit == "months":
			totalDays += num * 30 // Approximate month as 30 days
		case unit == "y" || unit == "year" || unit == "years":
			totalDays += num * 365 // Approximate year as 365 days
		}
	}

	if totalDays <= 0 {
		return "", fmt.Errorf("duration must be greater than 0")
	}

	// Return as days for the API
	return fmt.Sprintf("%dd", totalDays), nil
}
