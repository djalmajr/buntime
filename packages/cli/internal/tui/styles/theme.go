package styles

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// Color palette (Dracula-inspired)
var (
	ColorPrimary    = lipgloss.Color("#00D9FF") // Cyan
	ColorSecondary  = lipgloss.Color("#BD93F9") // Purple
	ColorSuccess    = lipgloss.Color("#50FA7B") // Green
	ColorWarning    = lipgloss.Color("#F1FA8C") // Yellow
	ColorError      = lipgloss.Color("#FF5555") // Red
	ColorMuted      = lipgloss.Color("#6272A4") // Gray
	ColorText       = lipgloss.Color("#F8F8F2") // White
	ColorBackground = lipgloss.Color("#282A36") // Dark
	ColorSurface    = lipgloss.Color("#44475A") // Surface
)

// Base styles
var (
	// Text styles
	TextNormal = lipgloss.NewStyle().
			Foreground(ColorText)

	TextMuted = lipgloss.NewStyle().
			Foreground(ColorMuted)

	TextPrimary = lipgloss.NewStyle().
			Foreground(ColorPrimary)

	TextSuccess = lipgloss.NewStyle().
			Foreground(ColorSuccess)

	TextError = lipgloss.NewStyle().
			Foreground(ColorError)

	TextWarning = lipgloss.NewStyle().
			Foreground(ColorWarning)

	// Bold variants
	BoldPrimary = TextPrimary.Bold(true)
	BoldSuccess = TextSuccess.Bold(true)
	BoldError   = TextError.Bold(true)
	BoldWarning = TextWarning.Bold(true)
)

// Container styles
var (
	// Main container with rounded border
	Container = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(ColorSurface).
			Padding(1, 2)

	// Card style for panels
	Card = lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(ColorSurface).
		Padding(1, 2)

	// Focused card
	CardFocused = Card.
			BorderForeground(ColorPrimary)
)

// Input constants
const (
	InputWidthSmall  = 30
	InputWidthMedium = 45
	InputWidthLarge  = 60
	InputWidthDefault = InputWidthMedium
)

// Input styles
var (
	InputNormal = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(ColorSurface).
			Padding(0, 1)

	InputFocused = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(ColorPrimary).
			Padding(0, 1)

	InputError = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(ColorError).
			Padding(0, 1)
)

// RenderInput renders a text input with consistent styling
func RenderInput(content string, focused bool, hasError bool) string {
	style := InputNormal
	if hasError {
		style = InputError
	} else if focused {
		style = InputFocused
	}
	return style.Width(InputWidthDefault).Render(content)
}

// RenderInputWithWidth renders a text input with custom width
func RenderInputWithWidth(content string, focused bool, hasError bool, width int) string {
	style := InputNormal
	if hasError {
		style = InputError
	} else if focused {
		style = InputFocused
	}
	return style.Width(width).Render(content)
}

// Button styles
var (
	Button = lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(ColorSurface).
		Padding(0, 2)

	ButtonFocused = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(ColorPrimary).
			Foreground(ColorPrimary).
			Padding(0, 2)

	ButtonPrimary = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(ColorSuccess).
			Foreground(ColorSuccess).
			Bold(true).
			Padding(0, 2)

	ButtonDanger = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(ColorError).
			Foreground(ColorError).
			Bold(true).
			Padding(0, 2)
)

// List styles
var (
	ListItem = lipgloss.NewStyle().
			PaddingLeft(2)

	ListItemSelected = lipgloss.NewStyle().
				Foreground(ColorPrimary).
				Bold(true)

	ListItemDimmed = lipgloss.NewStyle().
			Foreground(ColorMuted)
)

// Status indicators
var (
	DotConnected    = TextSuccess.Render("●")
	DotDisconnected = TextError.Render("○")
	DotError        = TextError.Render("●")
	DotWarning      = TextWarning.Render("●")

	// Caret for list selection
	Caret = TextPrimary.Bold(true).Render("▸ ")

	CheckEnabled  = TextSuccess.Render("✓")
	CheckDisabled = TextError.Render("✗")

	CheckboxChecked   = TextPrimary.Render("[✓]")
	CheckboxUnchecked = TextMuted.Render("[ ]")
)

// RenderCheckbox renders a styled checkbox with focus state
func RenderCheckbox(checked bool, focused bool) string {
	if checked {
		if focused {
			return TextPrimary.Bold(true).Render("[✓]")
		}
		return TextSuccess.Render("[✓]")
	}
	if focused {
		return TextPrimary.Render("[ ]")
	}
	return TextMuted.Render("[ ]")
}

// Header/Footer
var (
	Header = lipgloss.NewStyle().
		BorderStyle(lipgloss.NormalBorder()).
		BorderBottom(true).
		BorderForeground(ColorSurface).
		Padding(0, 1)

	Footer = lipgloss.NewStyle().
		Foreground(ColorMuted).
		Padding(0, 1)

	FooterKey = lipgloss.NewStyle().
			Foreground(ColorPrimary).
			Bold(true)

	FooterDesc = lipgloss.NewStyle().
			Foreground(ColorMuted)
)

// Title styles
var (
	Title = lipgloss.NewStyle().
		Foreground(ColorText).
		Bold(true).
		MarginBottom(1)

	Subtitle = lipgloss.NewStyle().
			Foreground(ColorMuted).
			MarginBottom(1)

	SectionTitle = lipgloss.NewStyle().
			Foreground(ColorMuted).
			Bold(true).
			MarginTop(1).
			MarginBottom(1)
)

// Helper functions

// PadRight pads a string to the specified visual width (accounting for ANSI codes)
func PadRight(s string, width int) string {
	visualWidth := lipgloss.Width(s)
	if visualWidth >= width {
		return s
	}
	return s + strings.Repeat(" ", width-visualWidth)
}

// Truncate truncates a string to the specified visual width (accounting for ANSI codes)
func Truncate(s string, maxWidth int) string {
	if lipgloss.Width(s) <= maxWidth {
		return s
	}
	// Truncate by removing runes until it fits
	runes := []rune(s)
	for len(runes) > 0 && lipgloss.Width(string(runes))+(3) > maxWidth {
		runes = runes[:len(runes)-1]
	}
	return string(runes) + "..."
}

func RenderShortcut(key, desc string) string {
	return FooterKey.Render(key) + " " + FooterDesc.Render(desc)
}

func RenderStatus(enabled bool) string {
	if enabled {
		return CheckEnabled
	}
	return CheckDisabled
}

func RenderDot(connected bool) string {
	if connected {
		return DotConnected
	}
	return DotDisconnected
}
