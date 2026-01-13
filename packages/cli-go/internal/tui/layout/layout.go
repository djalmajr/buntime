package layout

import (
	"strings"

	"github.com/buntime/cli/internal/db"
	"github.com/buntime/cli/internal/tui/styles"
	"github.com/charmbracelet/lipgloss"
)

// CardVariant defines the visual style of a card
type CardVariant int

const (
	CardDefault CardVariant = iota
	CardWarning
	CardError
	CardSuccess
)

// CardConfig holds configuration for rendering a card
type CardConfig struct {
	Width   int
	Variant CardVariant
	Content string
}

// Card renders a bordered card with the given content
func Card(cfg CardConfig) string {
	borderColor := styles.ColorSurface
	switch cfg.Variant {
	case CardWarning:
		borderColor = styles.ColorWarning
	case CardError:
		borderColor = styles.ColorError
	case CardSuccess:
		borderColor = styles.ColorSuccess
	}

	cardStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(borderColor).
		Padding(1, 2).
		Width(cfg.Width)

	return cardStyle.Render(cfg.Content)
}

// ConfirmModalConfig holds configuration for a confirmation modal
type ConfirmModalConfig struct {
	Width        int
	Title        string
	Warning      string
	DangerText   string // Optional danger/error message shown before input
	Items        []ConfirmModalItem
	ConfirmWord  string
	CurrentInput string
	InputView    string // Optional: pre-rendered input view (from textinput.Model)
}

// ConfirmModalItem represents an item to display in the confirmation modal
type ConfirmModalItem struct {
	Label string
	Value string
}

// ConfirmModal renders a confirmation modal with a text input
func ConfirmModal(cfg ConfirmModalConfig) string {
	var content strings.Builder

	// Warning title
	if cfg.Title != "" {
		content.WriteString(styles.TextWarning.Bold(true).Render(cfg.Title))
		content.WriteString("\n\n")
	} else {
		content.WriteString(styles.TextWarning.Bold(true).Render("Warning: This action cannot be undone."))
		content.WriteString("\n\n")
	}

	// Warning description
	if cfg.Warning != "" {
		content.WriteString(styles.TextNormal.Render(cfg.Warning))
		content.WriteString("\n\n")
	}

	// Items to be affected
	for _, item := range cfg.Items {
		content.WriteString("  " + styles.TextMuted.Render(item.Label+": ") + item.Value)
		content.WriteString("\n")
	}

	if len(cfg.Items) > 0 {
		content.WriteString("\n")
	}

	// Danger text (e.g., "Any systems using this key will lose access immediately.")
	if cfg.DangerText != "" {
		content.WriteString(styles.TextError.Render(cfg.DangerText))
		content.WriteString("\n\n")
	}

	// Confirm input prompt
	confirmWord := cfg.ConfirmWord
	if confirmWord == "" {
		confirmWord = "delete"
	}

	content.WriteString(styles.TextNormal.Render("Type \"" + confirmWord + "\" to confirm:"))
	content.WriteString("\n")

	// Input - use pre-rendered view if provided, otherwise render from CurrentInput
	if cfg.InputView != "" {
		content.WriteString(styles.RenderInputWithWidth(cfg.InputView, true, false, styles.InputWidthSmall))
	} else {
		hasError := cfg.CurrentInput != "" && !strings.HasPrefix(confirmWord, cfg.CurrentInput)
		inputContent := cfg.CurrentInput
		if inputContent == "" {
			inputContent = " "
		}
		content.WriteString(styles.RenderInputWithWidth(inputContent+"█", true, hasError, styles.InputWidthSmall))
	}

	return Card(CardConfig{
		Width:   cfg.Width,
		Variant: CardWarning,
		Content: content.String(),
	})
}

// PageConfig holds configuration for rendering a standard page with header
type PageConfig struct {
	Width      int
	Height     int
	Server     *db.Server
	Breadcrumb string // Optional breadcrumb path (e.g., "Main > Plugins")
	Title      string
	Content    string
	Shortcuts  []string
}

// Page renders a standard page layout with header, title, content, and footer
// Use this for screens that follow the standard pattern with a server header
func Page(cfg PageConfig) string {
	innerWidth := InnerWidth(cfg.Width)
	header := RenderHeader(innerWidth, cfg.Breadcrumb, cfg.Server)

	var b strings.Builder

	// Title (with one blank line before content)
	b.WriteString(styles.SectionTitle.Render(cfg.Title) + "\n")

	// Content (should not start with leading newline)
	b.WriteString(cfg.Content)

	// Footer (version is added automatically by ScreenWithHeader)
	var footer strings.Builder
	footer.WriteString(Divider(innerWidth) + "\n")
	footer.WriteString(Shortcuts(cfg.Shortcuts))

	return ScreenWithHeader(cfg.Width, cfg.Height, header, b.String(), footer.String())
}

// appendVersionToFooter adds version to the right side of the last footer line
func appendVersionToFooter(footerLines []string, width int) []string {
	if len(footerLines) == 0 {
		// No footer, just add version line
		return []string{renderVersionRight(width, "")}
	}

	// Get the last line and add version to it
	lastIdx := len(footerLines) - 1
	lastLine := footerLines[lastIdx]
	footerLines[lastIdx] = renderVersionRight(width, lastLine)

	return footerLines
}

// renderVersionRight renders content on left and version on right
func renderVersionRight(width int, left string) string {
	right := styles.TextMuted.Render("v" + Version)

	leftWidth := lipgloss.Width(left)
	rightWidth := lipgloss.Width(right)
	spacing := width - leftWidth - rightWidth
	if spacing < 1 {
		spacing = 1
	}

	return left + strings.Repeat(" ", spacing) + right
}

const (
	Version     = "1.0.0"
	MinWidth    = 40
	SidePadding = 2
)

// Screen wraps content in a rounded border box that fills the terminal
// Footer is always positioned at the bottom of the screen
// Version is automatically added to the right side of the last footer line
func Screen(width, height int, content, footer string) string {
	// Calculate inner width (accounting for border characters)
	innerWidth := width - 4
	if innerWidth < MinWidth {
		innerWidth = MinWidth
	}

	// Split content and footer into lines, removing trailing empty line
	contentLines := strings.Split(strings.TrimSuffix(content, "\n"), "\n")
	footerLines := strings.Split(strings.TrimSuffix(footer, "\n"), "\n")

	// Add version to the last footer line
	footerLines = appendVersionToFooter(footerLines, innerWidth)

	// Calculate inner height (accounting for top and bottom border)
	innerHeight := height - 2
	if innerHeight < 1 {
		innerHeight = 1
	}

	// Reserve space for footer at bottom
	footerHeight := len(footerLines)
	contentHeight := innerHeight - footerHeight
	if contentHeight < 0 {
		contentHeight = 0
	}

	// Build the screen with border
	var b strings.Builder

	// Top border
	topBorder := "╭" + strings.Repeat("─", innerWidth+2) + "╮"
	b.WriteString(centerLine(topBorder, width) + "\n")

	// Content lines (fill available space)
	for i := 0; i < contentHeight; i++ {
		var line string
		if i < len(contentLines) {
			line = contentLines[i]
		}
		line = truncateOrPad(line, innerWidth)
		b.WriteString(centerLine("│ "+line+" │", width) + "\n")
	}

	// Footer lines (always at bottom)
	for _, line := range footerLines {
		line = truncateOrPad(line, innerWidth)
		b.WriteString(centerLine("│ "+line+" │", width) + "\n")
	}

	// Bottom border
	bottomBorder := "╰" + strings.Repeat("─", innerWidth+2) + "╯"
	b.WriteString(centerLine(bottomBorder, width))

	return b.String()
}

// ScreenWithHeader renders a screen with a header bar (for connected screens)
// Footer is always positioned at the bottom of the screen
// Header can be multi-line (e.g., server info + breadcrumb)
// Version is automatically added to the right side of the last footer line
func ScreenWithHeader(width, height int, header, content, footer string) string {
	innerWidth := width - 4
	if innerWidth < MinWidth {
		innerWidth = MinWidth
	}

	headerLines := strings.Split(strings.TrimSuffix(header, "\n"), "\n")
	contentLines := strings.Split(strings.TrimSuffix(content, "\n"), "\n")
	footerLines := strings.Split(strings.TrimSuffix(footer, "\n"), "\n")

	// Add version to the last footer line
	footerLines = appendVersionToFooter(footerLines, innerWidth)

	// Calculate inner height: total - top border - header lines - header sep - bottom border
	headerHeight := len(headerLines)
	innerHeight := height - 3 - headerHeight
	if innerHeight < 1 {
		innerHeight = 1
	}

	// Reserve space for footer at bottom
	footerHeight := len(footerLines)
	contentHeight := innerHeight - footerHeight
	if contentHeight < 0 {
		contentHeight = 0
	}

	var b strings.Builder

	// Top border
	topBorder := "╭" + strings.Repeat("─", innerWidth+2) + "╮"
	b.WriteString(centerLine(topBorder, width) + "\n")

	// Header lines
	for _, hLine := range headerLines {
		headerLine := truncateOrPad(hLine, innerWidth)
		b.WriteString(centerLine("│ "+headerLine+" │", width) + "\n")
	}

	// Header separator
	headerSep := "├" + strings.Repeat("─", innerWidth+2) + "┤"
	b.WriteString(centerLine(headerSep, width) + "\n")

	// Content lines (fill available space)
	for i := 0; i < contentHeight; i++ {
		var line string
		if i < len(contentLines) {
			line = contentLines[i]
		}
		line = truncateOrPad(line, innerWidth)
		b.WriteString(centerLine("│ "+line+" │", width) + "\n")
	}

	// Footer lines (always at bottom)
	for _, line := range footerLines {
		line = truncateOrPad(line, innerWidth)
		b.WriteString(centerLine("│ "+line+" │", width) + "\n")
	}

	// Bottom border
	bottomBorder := "╰" + strings.Repeat("─", innerWidth+2) + "╯"
	b.WriteString(centerLine(bottomBorder, width))

	return b.String()
}

// InnerWidth returns the usable width inside the border
func InnerWidth(termWidth int) int {
	w := termWidth - 4
	if w < MinWidth {
		w = MinWidth
	}
	return w
}

// Divider returns a horizontal divider line
func Divider(width int) string {
	return styles.TextMuted.Render(strings.Repeat("─", width))
}

// CenterText centers text within a given width
func CenterText(text string, width int) string {
	textWidth := lipgloss.Width(text)
	if textWidth >= width {
		return text
	}
	padding := (width - textWidth) / 2
	return strings.Repeat(" ", padding) + text
}

// Shortcuts formats shortcut hints for the footer
func Shortcuts(items []string) string {
	return strings.Join(items, "   ")
}

// Helper functions

func centerLine(line string, termWidth int) string {
	lineWidth := lipgloss.Width(line)
	if lineWidth >= termWidth {
		return line
	}
	padding := (termWidth - lineWidth) / 2
	return strings.Repeat(" ", padding) + line
}

func truncateOrPad(s string, width int) string {
	sWidth := lipgloss.Width(s)
	if sWidth > width {
		// Truncate
		runes := []rune(s)
		for lipgloss.Width(string(runes)) > width-3 && len(runes) > 0 {
			runes = runes[:len(runes)-1]
		}
		return string(runes) + "..."
	}
	// Pad
	return s + strings.Repeat(" ", width-sWidth)
}

// Legacy functions for compatibility

// ContentWidth returns the width for content (respects max width)
func ContentWidth(termWidth int) int {
	return InnerWidth(termWidth)
}

// LeftPadding returns the left padding to center content with max width
func LeftPadding(termWidth int) int {
	contentWidth := ContentWidth(termWidth)
	if termWidth <= contentWidth+(SidePadding*2) {
		return SidePadding
	}
	return (termWidth - contentWidth) / 2
}

// Pad returns the padding string for content
func Pad(termWidth int) string {
	return strings.Repeat(" ", LeftPadding(termWidth))
}

// PadLeft adds left padding to content
func PadLeft(content string, termWidth int) string {
	padding := LeftPadding(termWidth)
	lines := strings.Split(content, "\n")
	var result []string
	for _, line := range lines {
		result = append(result, strings.Repeat(" ", padding)+line)
	}
	return strings.Join(result, "\n")
}

// ContentContainer returns a lipgloss style for centering content
func ContentContainer(termWidth int) lipgloss.Style {
	padding := LeftPadding(termWidth)
	return lipgloss.NewStyle().PaddingLeft(padding)
}

// RenderHeader renders a header for connected screens
// If breadcrumb is provided, shows: server name + URL on first line, breadcrumb on second
func RenderHeader(width int, breadcrumb string, server *db.Server) string {
	innerWidth := InnerWidth(width)

	if server == nil {
		// Just breadcrumb, no server info
		return styles.TextNormal.Bold(true).Render(breadcrumb)
	}

	// First line: Green dot + server name on left, URL on right
	left := styles.DotConnected + " " + styles.TextNormal.Bold(true).Render(server.Name)
	right := styles.TextMuted.Render(server.URL)

	leftWidth := lipgloss.Width(left)
	rightWidth := lipgloss.Width(right)
	spacing := innerWidth - leftWidth - rightWidth
	if spacing < 1 {
		spacing = 1
	}

	firstLine := left + strings.Repeat(" ", spacing) + right

	// If breadcrumb, add second line
	if breadcrumb != "" {
		secondLine := styles.TextMuted.Render("  " + breadcrumb)
		return firstLine + "\n" + secondLine
	}

	return firstLine
}

// RenderFooter renders footer shortcuts (deprecated - use Shortcuts instead)
func RenderFooter(termWidth, termHeight int, shortcuts []string) string {
	return Shortcuts(shortcuts)
}

// RenderFooterWithNotification renders footer with notification (deprecated)
func RenderFooterWithNotification(termWidth, termHeight int, shortcuts []string, notification string) string {
	return Shortcuts(shortcuts)
}

// RenderLayout renders content with fixed header at top and footer at bottom (deprecated)
func RenderLayout(termWidth, termHeight int, header, content, footer string) string {
	return content
}
