// Package bubbleui provides UI components for Bubble Tea applications.
//
// It includes layout components (Page, Card, Modal, Table), toast notifications,
// and a theming system for consistent styling across your TUI application.
//
// # Components
//
// Layout components provide structure:
//   - Page: Full-page layout with header, breadcrumb, and footer
//   - Card: Bordered container with variants (default, warning, error, success, info)
//   - ConfirmModal: Confirmation dialog requiring text input
//   - Table: Data table with cursor support
//
// Toast component provides non-intrusive notifications:
//   - Auto-dismissing messages
//   - Four types: Error, Success, Warning, Info
//   - Customizable styles and duration
//
// # Theming
//
// The Theme type allows customization of colors and text styles:
//
//	theme := bubbleui.DefaultTheme()
//	theme.Primary = lipgloss.Color("#00D9FF")
//
//	page := bubbleui.Page(bubbleui.PageConfig{
//	    Theme: &theme,
//	    // ... other config
//	})
//
// # Example
//
//	package main
//
//	import (
//	    "github.com/buntime/bubbleui"
//	    tea "github.com/charmbracelet/bubbletea"
//	)
//
//	type model struct {
//	    toast  *bubbleui.Toast
//	    theme  bubbleui.Theme
//	    width  int
//	    height int
//	}
//
//	func (m model) View() string {
//	    // Toast at top
//	    view := m.toast.View()
//
//	    // Content with layout
//	    content := bubbleui.Card(bubbleui.CardConfig{
//	        Width:   bubbleui.InnerWidth(m.width) - 4,
//	        Variant: bubbleui.CardSuccess,
//	        Content: "Hello, World!",
//	        Theme:   &m.theme,
//	    })
//
//	    view += bubbleui.Page(bubbleui.PageConfig{
//	        Width:      m.width,
//	        Height:     m.height,
//	        Title:      "MY APP",
//	        Content:    content,
//	        Theme:      &m.theme,
//	    })
//
//	    return view
//	}
package bubbleui

import (
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
)

// Theme holds color and style configuration for UI components.
type Theme struct {
	// Colors
	Primary    lipgloss.Color
	Surface    lipgloss.Color
	Background lipgloss.Color
	Foreground lipgloss.Color
	Muted      lipgloss.Color
	Error      lipgloss.Color
	Warning    lipgloss.Color
	Success    lipgloss.Color

	// Text styles
	TextNormal  lipgloss.Style
	TextMuted   lipgloss.Style
	TextPrimary lipgloss.Style
	TextError   lipgloss.Style
	TextWarning lipgloss.Style
	TextSuccess lipgloss.Style
}

// DefaultTheme returns a default theme with sensible colors.
func DefaultTheme() Theme {
	return Theme{
		Primary:    lipgloss.Color("39"),
		Surface:    lipgloss.Color("240"),
		Background: lipgloss.Color("235"),
		Foreground: lipgloss.Color("252"),
		Muted:      lipgloss.Color("245"),
		Error:      lipgloss.Color("196"),
		Warning:    lipgloss.Color("214"),
		Success:    lipgloss.Color("42"),

		TextNormal:  lipgloss.NewStyle().Foreground(lipgloss.Color("252")),
		TextMuted:   lipgloss.NewStyle().Foreground(lipgloss.Color("245")),
		TextPrimary: lipgloss.NewStyle().Foreground(lipgloss.Color("39")),
		TextError:   lipgloss.NewStyle().Foreground(lipgloss.Color("196")),
		TextWarning: lipgloss.NewStyle().Foreground(lipgloss.Color("214")),
		TextSuccess: lipgloss.NewStyle().Foreground(lipgloss.Color("42")),
	}
}

// ============================================================================
// Layout Components
// ============================================================================

// CardVariant defines the visual style of a card.
type CardVariant int

const (
	CardDefault CardVariant = iota
	CardWarning
	CardError
	CardSuccess
	CardInfo
)

// CardConfig holds configuration for rendering a card.
type CardConfig struct {
	Content string
	Theme   *Theme
	Variant CardVariant
	Width   int
}

// Card renders a bordered card with the given content.
func Card(cfg CardConfig) string {
	theme := cfg.Theme
	if theme == nil {
		t := DefaultTheme()
		theme = &t
	}

	borderColor := theme.Surface
	switch cfg.Variant {
	case CardWarning:
		borderColor = theme.Warning
	case CardError:
		borderColor = theme.Error
	case CardSuccess:
		borderColor = theme.Success
	case CardInfo:
		borderColor = theme.Primary
	}

	cardStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(borderColor).
		Padding(1, 2).
		Width(cfg.Width)

	return cardStyle.Render(cfg.Content)
}

// ConfirmModalItem represents an item to display in the confirmation modal.
type ConfirmModalItem struct {
	Label string
	Value string
}

// ConfirmModalConfig holds configuration for a confirmation modal.
type ConfirmModalConfig struct {
	ConfirmWord string
	DangerText  string // Optional danger/error message shown before input
	InputView   string // Pre-rendered input view (from textinput.Model)
	Items       []ConfirmModalItem
	Theme       *Theme
	Title       string
	Warning     string
	Width       int
}

// ConfirmModal renders a confirmation modal with a text input.
func ConfirmModal(cfg ConfirmModalConfig) string {
	theme := cfg.Theme
	if theme == nil {
		t := DefaultTheme()
		theme = &t
	}

	var content strings.Builder

	// Warning title
	if cfg.Title != "" {
		content.WriteString(theme.TextWarning.Bold(true).Render(cfg.Title))
		content.WriteString("\n\n")
	} else {
		content.WriteString(theme.TextWarning.Bold(true).Render("Warning: This action cannot be undone."))
		content.WriteString("\n\n")
	}

	// Warning description
	if cfg.Warning != "" {
		content.WriteString(theme.TextNormal.Render(cfg.Warning))
		content.WriteString("\n\n")
	}

	// Items to be affected
	for _, item := range cfg.Items {
		content.WriteString("  " + theme.TextMuted.Render(item.Label+": ") + item.Value)
		content.WriteString("\n")
	}

	if len(cfg.Items) > 0 {
		content.WriteString("\n")
	}

	// Danger text
	if cfg.DangerText != "" {
		content.WriteString(theme.TextError.Render(cfg.DangerText))
		content.WriteString("\n\n")
	}

	// Confirmation prompt
	content.WriteString(theme.TextNormal.Render("Type \""+cfg.ConfirmWord+"\" to confirm:") + "\n")
	content.WriteString(cfg.InputView)

	return Card(CardConfig{
		Width:   cfg.Width,
		Variant: CardWarning,
		Content: content.String(),
		Theme:   theme,
	})
}

// PageConfig holds configuration for rendering a page.
type PageConfig struct {
	Breadcrumb string
	Content    string
	Height     int
	Shortcuts  []string
	Theme      *Theme
	Title      string
	Width      int
}

// Page renders a full-page layout with header, content, and footer.
func Page(cfg PageConfig) string {
	theme := cfg.Theme
	if theme == nil {
		t := DefaultTheme()
		theme = &t
	}

	innerWidth := cfg.Width - 4 // Account for padding

	var page strings.Builder

	// Breadcrumb
	if cfg.Breadcrumb != "" {
		page.WriteString(theme.TextMuted.Render(cfg.Breadcrumb) + "\n\n")
	}

	// Title
	if cfg.Title != "" {
		page.WriteString(theme.TextNormal.Bold(true).Render(cfg.Title) + "\n")
		page.WriteString(strings.Repeat("─", innerWidth) + "\n\n")
	}

	// Content
	page.WriteString(cfg.Content)

	// Shortcuts footer
	if len(cfg.Shortcuts) > 0 {
		page.WriteString("\n\n")
		page.WriteString(strings.Repeat("─", innerWidth) + "\n")
		page.WriteString(strings.Join(cfg.Shortcuts, " "))
	}

	// Apply padding
	pageStyle := lipgloss.NewStyle().
		Padding(1, 2).
		Width(cfg.Width).
		Height(cfg.Height)

	return pageStyle.Render(page.String())
}

// TableConfig holds configuration for rendering a table.
type TableConfig struct {
	Cursor  int    // Current selected row (-1 for no selection)
	Headers []string
	Rows    [][]string
	Theme   *Theme
	Widths  []int // Column widths
	Width   int
}

// Table renders a simple table with headers and rows.
func Table(cfg TableConfig) string {
	theme := cfg.Theme
	if theme == nil {
		t := DefaultTheme()
		theme = &t
	}

	var table strings.Builder

	// Headers
	for i, header := range cfg.Headers {
		width := cfg.Widths[i]
		style := theme.TextNormal.Bold(true).Width(width)
		table.WriteString(style.Render(header) + "  ")
	}
	table.WriteString("\n")

	// Separator
	table.WriteString(strings.Repeat("─", cfg.Width-2) + "\n")

	// Rows
	for rowIdx, row := range cfg.Rows {
		// Cursor indicator
		if rowIdx == cfg.Cursor {
			table.WriteString(theme.TextPrimary.Render("▸ "))
		} else {
			table.WriteString("  ")
		}

		// Cells
		for colIdx, cell := range row {
			width := cfg.Widths[colIdx]
			style := theme.TextNormal.Width(width)
			if rowIdx == cfg.Cursor {
				style = theme.TextPrimary.Width(width)
			}
			table.WriteString(style.Render(cell) + "  ")
		}
		table.WriteString("\n")
	}

	return table.String()
}

// ============================================================================
// Utilities
// ============================================================================

// InnerWidth returns the usable width inside a page (accounting for padding).
func InnerWidth(pageWidth int) int {
	return pageWidth - 4 // 2 padding on each side
}

// CenterText centers text within a given width.
func CenterText(text string, width int) string {
	return lipgloss.NewStyle().
		Width(width).
		Align(lipgloss.Center).
		Render(text)
}

// RenderShortcut renders a keyboard shortcut with key and description.
func RenderShortcut(key, description string) string {
	theme := DefaultTheme()
	keyStyle := lipgloss.NewStyle().
		Foreground(theme.Muted).
		Bold(true)
	descStyle := lipgloss.NewStyle().
		Foreground(theme.Muted)

	return keyStyle.Render("["+key+"]") + " " + descStyle.Render(description)
}

// ============================================================================
// Toast Component
// ============================================================================

// ToastType represents the type of toast notification.
type ToastType int

const (
	ToastError ToastType = iota
	ToastSuccess
	ToastWarning
	ToastInfo
)

// toastData represents internal toast data.
type toastData struct {
	Duration  time.Duration
	ExpiresAt time.Time
	Message   string
	Type      ToastType
}

// Toast manages toast notifications.
type Toast struct {
	toast   *toastData
	visible bool
	width   int

	// Customizable styles
	ErrorStyle   lipgloss.Style
	InfoStyle    lipgloss.Style
	SuccessStyle lipgloss.Style
	WarningStyle lipgloss.Style
}

// NewToast creates a new toast manager with default styles.
func NewToast() *Toast {
	return &Toast{
		ErrorStyle: lipgloss.NewStyle().
			Foreground(lipgloss.Color("255")).
			Background(lipgloss.Color("196")).
			Bold(true).
			Padding(0, 2),
		SuccessStyle: lipgloss.NewStyle().
			Foreground(lipgloss.Color("255")).
			Background(lipgloss.Color("42")).
			Bold(true).
			Padding(0, 2),
		WarningStyle: lipgloss.NewStyle().
			Foreground(lipgloss.Color("0")).
			Background(lipgloss.Color("214")).
			Bold(true).
			Padding(0, 2),
		InfoStyle: lipgloss.NewStyle().
			Foreground(lipgloss.Color("255")).
			Background(lipgloss.Color("39")).
			Bold(true).
			Padding(0, 2),
	}
}

// Show displays a toast notification with custom duration.
func (t *Toast) Show(message string, toastType ToastType, duration time.Duration) {
	t.toast = &toastData{
		Message:   message,
		Type:      toastType,
		Duration:  duration,
		ExpiresAt: time.Now().Add(duration),
	}
	t.visible = true
}

// ShowError shows an error toast (default 5 seconds).
func (t *Toast) ShowError(message string) {
	t.Show(message, ToastError, 5*time.Second)
}

// ShowSuccess shows a success toast (default 3 seconds).
func (t *Toast) ShowSuccess(message string) {
	t.Show(message, ToastSuccess, 3*time.Second)
}

// ShowWarning shows a warning toast (default 4 seconds).
func (t *Toast) ShowWarning(message string) {
	t.Show(message, ToastWarning, 4*time.Second)
}

// ShowInfo shows an info toast (default 3 seconds).
func (t *Toast) ShowInfo(message string) {
	t.Show(message, ToastInfo, 3*time.Second)
}

// Hide hides the current toast.
func (t *Toast) Hide() {
	t.visible = false
	t.toast = nil
}

// IsVisible returns whether a toast is currently visible.
func (t *Toast) IsVisible() bool {
	if !t.visible || t.toast == nil {
		return false
	}
	return time.Now().Before(t.toast.ExpiresAt)
}

// SetWidth sets the width of the toast container.
func (t *Toast) SetWidth(width int) {
	t.width = width
}

// Update should be called periodically to check if the toast should be hidden.
func (t *Toast) Update() {
	if t.toast != nil && time.Now().After(t.toast.ExpiresAt) {
		t.Hide()
	}
}

// View renders the toast notification.
func (t *Toast) View() string {
	if !t.IsVisible() {
		return ""
	}

	var style lipgloss.Style
	var icon string

	switch t.toast.Type {
	case ToastError:
		style = t.ErrorStyle
		icon = "✗"
	case ToastSuccess:
		style = t.SuccessStyle
		icon = "✓"
	case ToastWarning:
		style = t.WarningStyle
		icon = "⚠"
	case ToastInfo:
		style = t.InfoStyle
		icon = "ℹ"
	}

	message := icon + " " + t.toast.Message

	// Center the toast
	if t.width > 0 {
		style = style.Width(t.width).Align(lipgloss.Center)
	}

	return style.Render(message) + "\n\n"
}

// ============================================================================
// Bubble Tea Messages
// ============================================================================

// ShowToastMsg is a Bubble Tea message for showing a toast.
type ShowToastMsg struct {
	Message string
	Type    ToastType
}

// ToastTickMsg is a Bubble Tea message for updating toast state.
type ToastTickMsg time.Time

// Helper functions to create toast messages

// ShowErrorMsg creates a message to show an error toast.
func ShowErrorMsg(message string) ShowToastMsg {
	return ShowToastMsg{Message: message, Type: ToastError}
}

// ShowSuccessMsg creates a message to show a success toast.
func ShowSuccessMsg(message string) ShowToastMsg {
	return ShowToastMsg{Message: message, Type: ToastSuccess}
}

// ShowWarningMsg creates a message to show a warning toast.
func ShowWarningMsg(message string) ShowToastMsg {
	return ShowToastMsg{Message: message, Type: ToastWarning}
}

// ShowInfoMsg creates a message to show an info toast.
func ShowInfoMsg(message string) ShowToastMsg {
	return ShowToastMsg{Message: message, Type: ToastInfo}
}
