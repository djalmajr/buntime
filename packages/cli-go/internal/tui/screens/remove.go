package screens

import (
	"fmt"
	"strings"

	"github.com/buntime/cli/internal/api"
	"github.com/buntime/cli/internal/db"
	"github.com/buntime/cli/internal/tui/layout"
	"github.com/buntime/cli/internal/tui/styles"
	tea "github.com/charmbracelet/bubbletea"
)

type removeState int

const (
	removeStateSelect removeState = iota
	removeStateConfirm
	removeStateRemoving
	removeStateSuccess
	removeStateFailed
)

// RemoveModel handles version removal
type RemoveModel struct {
	api          *api.Client
	server       *db.Server
	itemType     string // "app" or "plugin"
	name         string
	pluginID     int    // Only used for plugins (API uses ID)
	versions     []string
	selected     map[int]bool
	cursor       int
	state        removeState
	confirmInput string
	err          error
	width        int
	height       int
}

// NewRemoveModel creates a remove screen for apps
func NewRemoveModel(client *api.Client, server *db.Server, itemType, name string, versions []string, width, height int) *RemoveModel {
	return &RemoveModel{
		api:      client,
		server:   server,
		itemType: itemType,
		name:     name,
		versions: versions,
		selected: make(map[int]bool),
		state:    removeStateSelect,
		width:    width,
		height:   height,
	}
}

// NewRemovePluginModel creates a remove screen for plugins (uses ID)
func NewRemovePluginModel(client *api.Client, server *db.Server, plugin *api.PluginInfo, width, height int) *RemoveModel {
	return &RemoveModel{
		api:      client,
		server:   server,
		itemType: "plugin",
		name:     plugin.Name,
		pluginID: plugin.ID,
		versions: plugin.Versions,
		selected: make(map[int]bool),
		state:    removeStateConfirm, // Skip selection, go directly to confirm
		width:    width,
		height:   height,
	}
}

func (m *RemoveModel) Init() tea.Cmd {
	return nil
}

func (m *RemoveModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case tea.KeyMsg:
		switch m.state {
		case removeStateSelect:
			return m.updateSelect(msg)
		case removeStateConfirm:
			return m.updateConfirm(msg)
		case removeStateSuccess, removeStateFailed:
			// Navigate back to the appropriate list screen, replacing history
			targetScreen := ScreenApps
			if m.itemType == "plugin" {
				targetScreen = ScreenPlugins
			}
			return m, func() tea.Msg {
				return NavigateMsg{Screen: targetScreen, Data: nil, ReplaceHistory: true}
			}
		}

	case removeResultMsg:
		if msg.err != nil {
			m.state = removeStateFailed
			m.err = msg.err
			return m, nil
		}
		m.state = removeStateSuccess
		return m, nil
	}

	return m, nil
}

func (m *RemoveModel) updateSelect(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "up", "k":
		if m.cursor > 0 {
			m.cursor--
		}
	case "down", "j":
		if m.cursor < len(m.versions)-1 {
			m.cursor++
		}
	case " ", "space":
		m.selected[m.cursor] = !m.selected[m.cursor]
	case "a":
		// Select all
		for i := range m.versions {
			m.selected[i] = true
		}
	case "n":
		// Select none
		m.selected = make(map[int]bool)
	case "enter":
		if m.countSelected() > 0 {
			m.state = removeStateConfirm
		}
	case "esc":
		// Navigate back to apps list, replacing history
		return m, func() tea.Msg {
			return NavigateMsg{Screen: ScreenApps, Data: nil, ReplaceHistory: true}
		}
	}
	return m, nil
}

func (m *RemoveModel) updateConfirm(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "backspace":
		if len(m.confirmInput) > 0 {
			m.confirmInput = m.confirmInput[:len(m.confirmInput)-1]
		}
	case "enter":
		if m.confirmInput == "remove" {
			m.state = removeStateRemoving
			return m, m.remove()
		}
	case "esc":
		// For plugins, go back to plugins list (no version selection screen)
		if m.itemType == "plugin" {
			return m, func() tea.Msg {
				return NavigateMsg{Screen: ScreenPlugins, Data: nil, ReplaceHistory: true}
			}
		}
		// For apps, go back to version selection
		m.state = removeStateSelect
		m.confirmInput = ""
	default:
		if len(msg.String()) == 1 && len(m.confirmInput) < 10 {
			m.confirmInput += msg.String()
		}
	}
	return m, nil
}

func (m *RemoveModel) countSelected() int {
	count := 0
	for _, selected := range m.selected {
		if selected {
			count++
		}
	}
	return count
}

func (m *RemoveModel) remove() tea.Cmd {
	return func() tea.Msg {
		// For plugins, use ID-based deletion (removes entire plugin)
		if m.itemType == "plugin" {
			err := m.api.RemovePlugin(m.pluginID)
			return removeResultMsg{err: err}
		}

		// For apps, remove selected versions
		for i, selected := range m.selected {
			if !selected {
				continue
			}

			version := m.versions[i]
			err := m.api.RemoveApp(m.name, version)
			if err != nil {
				return removeResultMsg{err: err}
			}
		}

		return removeResultMsg{}
	}
}

type removeResultMsg struct {
	err error
}

func (m *RemoveModel) View() string {
	innerWidth := layout.InnerWidth(m.width)
	titleText := fmt.Sprintf("REMOVE %s", strings.ToUpper(m.itemType))

	breadcrumb := "Main › Apps › Remove"
	if m.itemType == "plugin" {
		breadcrumb = "Main › Plugins › Remove"
	}

	return layout.Page(layout.PageConfig{
		Width:      m.width,
		Height:     m.height,
		Server:     m.server,
		Breadcrumb: breadcrumb,
		Title:      titleText,
		Content:    m.renderContent(innerWidth),
		Shortcuts:  m.getShortcuts(),
	})
}

func (m *RemoveModel) renderContent(width int) string {
	switch m.state {
	case removeStateConfirm:
		return m.renderConfirm(width)
	case removeStateRemoving:
		return m.renderRemoving()
	case removeStateSuccess:
		return m.renderSuccess(width)
	case removeStateFailed:
		return m.renderFailed()
	default:
		return m.renderSelect()
	}
}

func (m *RemoveModel) renderSelect() string {
	var b strings.Builder

	// Item name
	b.WriteString(styles.TextMuted.Render("Select versions to remove from "))
	b.WriteString(styles.TextPrimary.Bold(true).Render(m.name))
	b.WriteString(":")
	b.WriteString("\n\n")

	// Version list
	for i, version := range m.versions {
		cursor := "  "
		if i == m.cursor {
			cursor = styles.Caret
		}

		checkbox := styles.CheckboxUnchecked
		if m.selected[i] {
			checkbox = styles.CheckboxChecked
		}

		versionText := version
		if i == 0 {
			versionText += styles.TextMuted.Render(" (current)")
		}

		style := styles.TextNormal
		if i == m.cursor {
			style = styles.TextPrimary
		}

		b.WriteString(cursor + checkbox + " " + style.Render(versionText))
		b.WriteString("\n")
	}

	// Selected count
	count := m.countSelected()
	b.WriteString("\n")
	b.WriteString(styles.TextMuted.Render(fmt.Sprintf("%d version(s) selected", count)))

	// Warning for current version
	if m.selected[0] && len(m.versions) > 0 {
		b.WriteString("\n\n")
		b.WriteString(styles.TextWarning.Render(
			"WARNING: Removing current version will disable this " + m.itemType))
	}

	return b.String()
}

func (m *RemoveModel) renderConfirm(width int) string {
	var items []layout.ConfirmModalItem

	// For plugins, show the plugin name (removes all versions)
	if m.itemType == "plugin" {
		items = []layout.ConfirmModalItem{
			{Label: "Plugin", Value: m.name},
		}
		if len(m.versions) > 0 {
			items = append(items, layout.ConfirmModalItem{
				Label: "Versions",
				Value: fmt.Sprintf("%d (%s)", len(m.versions), strings.Join(m.versions, ", ")),
			})
		}
	} else {
		// For apps, build items list from selected versions
		for i, selected := range m.selected {
			if selected {
				items = append(items, layout.ConfirmModalItem{
					Label: m.name,
					Value: "v" + m.versions[i],
				})
			}
		}
	}

	return layout.ConfirmModal(layout.ConfirmModalConfig{
		Width:        width - 4,
		Warning:      "You are about to remove:",
		Items:        items,
		ConfirmWord:  "remove",
		CurrentInput: m.confirmInput,
	})
}

func (m *RemoveModel) renderRemoving() string {
	var b strings.Builder

	b.WriteString(styles.TextPrimary.Render("Removing...") + "\n\n")

	for i, selected := range m.selected {
		if selected {
			b.WriteString(styles.TextMuted.Render("  - "+m.name+" v"+m.versions[i]) + "\n")
		}
	}

	return b.String()
}

func (m *RemoveModel) renderSuccess(width int) string {
	var b strings.Builder

	b.WriteString(layout.CenterText(styles.TextSuccess.Bold(true).Render("✓ REMOVAL COMPLETE"), width) + "\n")
	b.WriteString("\n")

	if m.itemType == "plugin" {
		b.WriteString(styles.TextNormal.Render(fmt.Sprintf("Successfully removed plugin %s.", m.name)) + "\n")
	} else {
		count := m.countSelected()
		b.WriteString(styles.TextNormal.Render(fmt.Sprintf("Successfully removed %d version(s).", count)) + "\n")
	}

	b.WriteString("\n")
	b.WriteString(styles.TextMuted.Render("Press any key to continue.") + "\n")

	return b.String()
}

func (m *RemoveModel) renderFailed() string {
	var b strings.Builder

	b.WriteString(styles.TextError.Bold(true).Render("✗ REMOVAL FAILED") + "\n\n")

	if m.err != nil {
		b.WriteString(styles.TextError.Render("Error: "+m.err.Error()) + "\n\n")
	}

	b.WriteString(styles.TextMuted.Render("Press any key to go back.") + "\n")

	return b.String()
}

func (m *RemoveModel) getShortcuts() []string {
	switch m.state {
	case removeStateSelect:
		return []string{
			styles.RenderShortcut("↑↓", "navigate"),
			styles.RenderShortcut("space", "toggle"),
			styles.RenderShortcut("a", "all"),
			styles.RenderShortcut("n", "none"),
			styles.RenderShortcut("⏎", "confirm"),
			styles.RenderShortcut("Esc", "cancel"),
		}
	case removeStateConfirm:
		return []string{
			styles.RenderShortcut("Esc", "cancel"),
		}
	case removeStateRemoving:
		return []string{}
	default:
		return []string{
			styles.RenderShortcut("any key", "continue"),
		}
	}
}
