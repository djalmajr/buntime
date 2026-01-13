package components

import (
	"time"

	"github.com/buntime/cli/internal/tui/styles"
	"github.com/charmbracelet/lipgloss"
)

// ToastType represents the type of toast notification
type ToastType int

const (
	ToastError ToastType = iota
	ToastSuccess
	ToastWarning
	ToastInfo
)

// Toast represents a toast notification
type Toast struct {
	Message   string
	Type      ToastType
	ExpiresAt time.Time
	Duration  time.Duration
}

// ToastModel manages toast notifications
type ToastModel struct {
	toast   *Toast
	width   int
	visible bool
}

// NewToastModel creates a new toast model
func NewToastModel() *ToastModel {
	return &ToastModel{}
}

// Show displays a toast notification
func (m *ToastModel) Show(message string, toastType ToastType, duration time.Duration) {
	m.toast = &Toast{
		Message:   message,
		Type:      toastType,
		Duration:  duration,
		ExpiresAt: time.Now().Add(duration),
	}
	m.visible = true
}

// ShowError shows an error toast (default 5 seconds)
func (m *ToastModel) ShowError(message string) {
	m.Show(message, ToastError, 5*time.Second)
}

// ShowSuccess shows a success toast (default 3 seconds)
func (m *ToastModel) ShowSuccess(message string) {
	m.Show(message, ToastSuccess, 3*time.Second)
}

// ShowWarning shows a warning toast (default 4 seconds)
func (m *ToastModel) ShowWarning(message string) {
	m.Show(message, ToastWarning, 4*time.Second)
}

// ShowInfo shows an info toast (default 3 seconds)
func (m *ToastModel) ShowInfo(message string) {
	m.Show(message, ToastInfo, 3*time.Second)
}

// Hide hides the current toast
func (m *ToastModel) Hide() {
	m.visible = false
	m.toast = nil
}

// IsVisible returns whether a toast is currently visible
func (m *ToastModel) IsVisible() bool {
	if !m.visible || m.toast == nil {
		return false
	}
	// Check if expired
	if time.Now().After(m.toast.ExpiresAt) {
		m.Hide()
		return false
	}
	return true
}

// SetWidth sets the width for rendering
func (m *ToastModel) SetWidth(width int) {
	m.width = width
}

// Update checks if toast should be hidden (call on tick)
func (m *ToastModel) Update() bool {
	if m.visible && m.toast != nil && time.Now().After(m.toast.ExpiresAt) {
		m.Hide()
		return true // changed
	}
	return false
}

// View renders the toast notification (just the toast box, not positioned)
func (m *ToastModel) View() string {
	if !m.IsVisible() {
		return ""
	}

	var style lipgloss.Style
	var icon string

	switch m.toast.Type {
	case ToastError:
		style = toastErrorStyle
		icon = "✗ "
	case ToastSuccess:
		style = toastSuccessStyle
		icon = "✓ "
	case ToastWarning:
		style = toastWarningStyle
		icon = "⚠ "
	case ToastInfo:
		style = toastInfoStyle
		icon = "ℹ "
	}

	message := icon + m.toast.Message

	// Toast is 80% of the inner content width with max of 60 chars
	// Subtract 4 for container borders (│ on each side)
	innerWidth := m.width - 4
	toastWidth := int(float64(innerWidth) * 0.8)
	if toastWidth < 30 {
		toastWidth = 30
	}
	if toastWidth > 60 {
		toastWidth = 60
	}

	// Use word wrap instead of truncating
	return style.Width(toastWidth).Render(message)
}

// ToastWidth returns the width of the toast for centering calculations
func (m *ToastModel) ToastWidth() int {
	innerWidth := m.width - 4
	toastWidth := int(float64(innerWidth) * 0.8)
	if toastWidth < 30 {
		toastWidth = 30
	}
	if toastWidth > 60 {
		toastWidth = 60
	}
	return toastWidth
}

// Toast styles
var (
	toastBaseStyle = lipgloss.NewStyle().
			Padding(0, 2).
			Bold(true)

	toastErrorStyle = toastBaseStyle.
			Foreground(styles.ColorText).
			Background(styles.ColorError)

	toastSuccessStyle = toastBaseStyle.
				Foreground(styles.ColorBackground).
				Background(styles.ColorSuccess)

	toastWarningStyle = toastBaseStyle.
				Foreground(styles.ColorBackground).
				Background(styles.ColorWarning)

	toastInfoStyle = toastBaseStyle.
			Foreground(styles.ColorText).
			Background(styles.ColorPrimary)
)
