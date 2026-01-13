package tui

import (
	"strings"
	"time"

	"github.com/buntime/bubblenav"
	"github.com/buntime/bubbleui"
	"github.com/buntime/cli/internal/api"
	"github.com/buntime/cli/internal/db"
	"github.com/buntime/cli/internal/tui/messages"
	"github.com/buntime/cli/internal/tui/screens"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Screen represents the current screen
type Screen int

const (
	ScreenServerSelect Screen = iota
	ScreenAddServer
	ScreenEditServer
	ScreenTokenPrompt
	ScreenMainMenu
	ScreenApps
	ScreenAppInstall
	ScreenAppRemove
	ScreenPlugins
	ScreenPluginInstall
	ScreenPluginRemove
	ScreenSettings
	ScreenKeys
	ScreenKeyCreate
	ScreenKeyRevoke
)

// Model is the main TUI model
type Model struct {
	// Dependencies
	db  *db.DB
	api *api.Client

	// Navigation
	router       *bubblenav.Router[Screen]
	screenModels map[Screen]tea.Model

	// Connection state
	currentServer *db.Server
	connected     bool

	// Window size
	width  int
	height int

	// Toast notifications
	toast *bubbleui.Toast

	// Flags
	quitting    bool
	initialized bool
}

// NewModel creates a new TUI model
func NewModel(database *db.DB) *Model {
	toast := bubbleui.NewToast()
	toast.SetWidth(80)

	return &Model{
		db:           database,
		router:       bubblenav.New(ScreenServerSelect),
		screenModels: make(map[Screen]tea.Model),
		width:        80,
		height:       24,
		toast:        toast,
	}
}

// Init initializes the model
func (m *Model) Init() tea.Cmd {
	// Initialize first screen
	m.screenModels[ScreenServerSelect] = screens.NewServerSelectModel(m.db, m.width, m.height)
	return tea.Batch(
		m.screenModels[ScreenServerSelect].Init(),
		toastTick(),
	)
}

// toastTick returns a command that ticks every 100ms for toast updates
func toastTick() tea.Cmd {
	return tea.Tick(100*time.Millisecond, func(t time.Time) tea.Msg {
		return messages.ToastTickMsg(t)
	})
}

// Update handles messages
func (m *Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.toast.SetWidth(msg.Width)

		// Update current screen size
		if screenModel, ok := m.screenModels[m.router.Current()]; ok {
			newModel, cmd := screenModel.Update(msg)
			m.screenModels[m.router.Current()] = newModel
			return m, cmd
		}
		return m, nil

	case tea.KeyMsg:
		if msg.Type == tea.KeyCtrlC {
			m.quitting = true
			return m, tea.Quit
		}

	// Toast messages
	case bubbleui.ShowToastMsg:
		switch msg.Type {
		case bubbleui.ToastError:
			m.toast.ShowError(msg.Message)
		case bubbleui.ToastSuccess:
			m.toast.ShowSuccess(msg.Message)
		case bubbleui.ToastWarning:
			m.toast.ShowWarning(msg.Message)
		case bubbleui.ToastInfo:
			m.toast.ShowInfo(msg.Message)
		}
		return m, nil

	case bubbleui.ToastTickMsg:
		m.toast.Update()
		return m, toastTick()

	// Navigation messages from screens
	case screens.NavigateMsg:
		// If navigating back to server select, reset connection state and history
		if msg.Screen == screens.ScreenServerSelect {
			m.connected = false
			m.currentServer = nil
			m.api = nil
			// Reset router to clear history (ServerSelect is the root screen)
			m.router.Reset(ScreenServerSelect, nil)
			m.initScreen(ScreenServerSelect, nil)
			if screenModel, ok := m.screenModels[m.router.Current()]; ok {
				return m, screenModel.Init()
			}
			return m, nil
		}
		return m.handleNavigation(msg)

	case screens.GoBackMsg:
		return m.goBack()

	case screens.ConnectedMsg:
		m.api = msg.Client
		m.currentServer = msg.Server
		m.connected = true
		// Reset router and navigate to Main Menu
		m.router.Reset(ScreenMainMenu, nil)
		m.initScreen(ScreenMainMenu, nil)
		if screenModel, ok := m.screenModels[m.router.Current()]; ok {
			return m, screenModel.Init()
		}
		return m, nil

	case messages.ServerSavedMsg:
		if msg.Err != nil {
			m.toast.ShowError("Failed to save server: " + msg.Err.Error())
			return m, nil
		}
		m.toast.ShowSuccess("Server saved successfully")
		return m.navigateTo(ScreenServerSelect, nil)
	}

	// Delegate to current screen
	if screenModel, ok := m.screenModels[m.router.Current()]; ok {
		newModel, cmd := screenModel.Update(msg)
		m.screenModels[m.router.Current()] = newModel
		return m, cmd
	}

	return m, nil
}


func (m *Model) handleNavigation(msg screens.NavigateMsg) (tea.Model, tea.Cmd) {
	// Map screen constants
	var screen Screen
	switch msg.Screen {
	case screens.ScreenServerSelect:
		screen = ScreenServerSelect
	case screens.ScreenAddServer:
		screen = ScreenAddServer
	case screens.ScreenEditServer:
		screen = ScreenEditServer
	case screens.ScreenTokenPrompt:
		screen = ScreenTokenPrompt
	case screens.ScreenMainMenu:
		screen = ScreenMainMenu
	case screens.ScreenApps:
		screen = ScreenApps
	case screens.ScreenAppInstall:
		screen = ScreenAppInstall
	case screens.ScreenAppRemove:
		screen = ScreenAppRemove
	case screens.ScreenPlugins:
		screen = ScreenPlugins
	case screens.ScreenPluginInstall:
		screen = ScreenPluginInstall
	case screens.ScreenPluginRemove:
		screen = ScreenPluginRemove
	case screens.ScreenSettings:
		screen = ScreenSettings
	case screens.ScreenKeys:
		screen = ScreenKeys
	case screens.ScreenKeyCreate:
		screen = ScreenKeyCreate
	case screens.ScreenKeyRevoke:
		screen = ScreenKeyRevoke
	default:
		return m, nil
	}

	return m.navigateToWithOptions(screen, msg.Data, msg.ReplaceHistory)
}

// View renders the model
func (m *Model) View() string {
	if m.quitting {
		return ""
	}

	var screenView string
	if screenModel, ok := m.screenModels[m.router.Current()]; ok {
		screenView = screenModel.View()
	} else {
		screenView = "Loading..."
	}

	// Overlay toast at the bottom if visible
	if m.toast.IsVisible() {
		lines := strings.Split(screenView, "\n")
		toastView := m.toast.View()
		toastLines := strings.Split(toastView, "\n")

		// Calculate inner width for centering
		innerWidth := m.width - 4
		if innerWidth < 40 {
			innerWidth = 40
		}

		// Find position to insert toast (above footer, inside container)
		// Skip bottom border line and insert above it
		insertPos := len(lines) - len(toastLines) - 2
		if insertPos < 1 {
			insertPos = 1
		}

		for i, toastLine := range toastLines {
			lineIdx := insertPos + i
			if lineIdx >= 0 && lineIdx < len(lines) {
				originalLine := lines[lineIdx]

				// Check if this line has container borders
				if strings.Contains(originalLine, "│") {
					// Find the left border position
					leftBorderIdx := strings.Index(originalLine, "│")
					if leftBorderIdx >= 0 {
						// Build new line: preserve left padding + border, center toast, add right border
						leftPart := originalLine[:leftBorderIdx+len("│")] + " "

						// Center the toast line within inner width
						toastLineWidth := lipgloss.Width(toastLine)
						padding := (innerWidth - toastLineWidth) / 2
						if padding < 0 {
							padding = 0
						}

						centeredToast := strings.Repeat(" ", padding) + toastLine
						// Pad to fill inner width
						remaining := innerWidth - lipgloss.Width(centeredToast)
						if remaining > 0 {
							centeredToast += strings.Repeat(" ", remaining)
						}

						lines[lineIdx] = leftPart + centeredToast + " │"
					}
				}
			}
		}

		return strings.Join(lines, "\n")
	}

	return screenView
}

func (m *Model) initScreen(screen Screen, data interface{}) {
	switch screen {
	case ScreenServerSelect:
		m.screenModels[screen] = screens.NewServerSelectModel(m.db, m.width, m.height)
	case ScreenAddServer:
		m.screenModels[screen] = screens.NewAddServerModel(m.db, m.width, m.height)
	case ScreenEditServer:
		if server, ok := data.(*db.Server); ok {
			m.screenModels[screen] = screens.NewEditServerModel(m.db, server, m.width, m.height)
		}
	case ScreenTokenPrompt:
		if server, ok := data.(*db.Server); ok {
			m.screenModels[screen] = screens.NewTokenPromptModel(m.db, server, m.width, m.height)
		}
	case ScreenMainMenu:
		m.screenModels[screen] = screens.NewMainMenuModel(m.api, m.currentServer, m.width, m.height)
	case ScreenApps:
		m.screenModels[screen] = screens.NewAppsModel(m.api, m.currentServer, m.width, m.height)
	case ScreenPlugins:
		m.screenModels[screen] = screens.NewPluginsModel(m.api, m.currentServer, m.width, m.height)
	case ScreenAppInstall:
		m.screenModels[screen] = screens.NewInstallModel(m.api, m.currentServer, "app", m.width, m.height)
	case ScreenPluginInstall:
		m.screenModels[screen] = screens.NewInstallModel(m.api, m.currentServer, "plugin", m.width, m.height)
	case ScreenAppRemove:
		if app, ok := data.(*api.AppInfo); ok {
			m.screenModels[screen] = screens.NewRemoveModel(m.api, m.currentServer, "app", app.Name, app.Versions, m.width, m.height)
		}
	case ScreenPluginRemove:
		if plugin, ok := data.(*api.PluginInfo); ok {
			m.screenModels[screen] = screens.NewRemovePluginModel(m.api, m.currentServer, plugin, m.width, m.height)
		}
	case ScreenKeys:
		m.screenModels[screen] = screens.NewKeysModel(m.api, m.currentServer, m.width, m.height)
	case ScreenKeyCreate:
		m.screenModels[screen] = screens.NewKeyCreateModel(m.api, m.currentServer, m.width, m.height)
	case ScreenKeyRevoke:
		if key, ok := data.(*api.ApiKeyInfo); ok {
			m.screenModels[screen] = screens.NewKeyRevokeModel(m.api, m.currentServer, key, m.width, m.height)
		}
	case ScreenSettings:
		m.screenModels[screen] = screens.NewSettingsModel(m.api, m.db, m.currentServer, m.width, m.height)
	}
}

func (m *Model) navigateTo(screen Screen, data interface{}) (*Model, tea.Cmd) {
	return m.navigateToWithOptions(screen, data, false)
}

func (m *Model) navigateToWithOptions(screen Screen, data interface{}, replaceHistory bool) (*Model, tea.Cmd) {
	// Use router for navigation
	if replaceHistory {
		m.router.Replace(screen, data)
	} else {
		m.router.Push(screen, data)
	}

	m.initScreen(screen, data)

	// Initialize the new screen
	if screenModel, ok := m.screenModels[screen]; ok {
		cmd := screenModel.Init()
		return m, cmd
	}

	return m, nil
}

func (m *Model) goBack() (*Model, tea.Cmd) {
	if !m.router.CanGoBack() {
		return m, nil
	}

	// Pop from history using router
	screen, _ := m.router.Pop()

	// Re-initialize the screen
	if screenModel, ok := m.screenModels[screen]; ok {
		cmd := screenModel.Init()
		return m, cmd
	}

	return m, nil
}
