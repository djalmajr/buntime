# Bubble Tea Packages Integration Guide

Complete guide for using bubblenav and bubbleui together.

## Packages Created

### 1. **bubblenav** - Navigation & Routing
- Stack-based navigation with history
- Type-safe screen management with Go generics
- Push/pop/replace operations
- Data passing between screens

### 2. **bubbleui** - UI Component Kit
**Layout Components:**
- Page layout with header/footer
- Cards with variants (default, warning, error, success, info)
- Confirmation modals
- Tables with cursor
- Theming support

**Toast Notifications:**
- Auto-dismissing notifications
- Error/Success/Warning/Info types
- Customizable styles
- Message-based API

## Complete Integration Example

```go
package main

import (
    "time"

    "github.com/buntime/bubblenav"
    "github.com/buntime/bubbleui"
    "github.com/buntime/bubbleui"
    tea "github.com/charmbracelet/bubbletea"
)

// Define screens
type Screen int

const (
    HomeScreen Screen = iota
    SettingsScreen
    ConfirmDeleteScreen
)

// Main model
type model struct {
    router *bubblenav.Router[Screen]
    toast  *bubbleui.Model
    theme  bubbleui.Theme
    width  int
    height int

    // Screen-specific models
    homeModel     homeModel
    settingsModel settingsModel
}

func initialModel() model {
    return model{
        router: bubblenav.New(HomeScreen),
        toast:  bubbleui.New(),
        theme:  bubbleui.DefaultTheme(),
    }
}

func (m model) Init() tea.Cmd {
    return tea.Batch(
        toastTick(),
    )
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    switch msg := msg.(type) {
    case tea.WindowSizeMsg:
        m.width = msg.Width
        m.height = msg.Height
        m.toast.SetWidth(msg.Width)
        return m, nil

    case tea.KeyMsg:
        if msg.String() == "ctrl+c" {
            return m, tea.Quit
        }

    // Toast management
    case bubbleui.TickMsg:
        m.toast.Update()
        return m, toastTick()

    case bubbleui.ShowMsg:
        switch msg.Type {
        case bubbleui.Error:
            m.toast.ShowError(msg.Message)
        case bubbleui.Success:
            m.toast.ShowSuccess(msg.Message)
        case bubbleui.Warning:
            m.toast.ShowWarning(msg.Message)
        case bubbleui.Info:
            m.toast.ShowInfo(msg.Message)
        }
        return m, nil

    // Navigation management
    case bubblenav.NavigateMsg[Screen]:
        if msg.ReplaceHistory {
            m.router.Replace(msg.Screen, msg.Data)
        } else {
            m.router.Push(msg.Screen, msg.Data)
        }
        return m, m.initCurrentScreen()

    case bubblenav.GoBackMsg:
        m.router.Pop()
        return m, m.initCurrentScreen()
    }

    // Delegate to current screen
    return m.updateCurrentScreen(msg)
}

func (m model) View() string {
    // Toast always at top
    view := m.toast.View()

    // Render current screen
    view += m.renderCurrentScreen()

    return view
}

func (m model) renderCurrentScreen() string {
    switch m.router.Current() {
    case HomeScreen:
        return m.renderHome()
    case SettingsScreen:
        return m.renderSettings()
    case ConfirmDeleteScreen:
        return m.renderConfirmDelete()
    default:
        return "Unknown screen"
    }
}

func (m model) renderHome() string {
    content := bubbleui.Card(bubbleui.CardConfig{
        Width:   bubbleui.InnerWidth(m.width) - 4,
        Variant: bubbleui.CardDefault,
        Content: "Welcome to the home screen!\n\nPress 's' for settings",
        Theme:   &m.theme,
    })

    return bubbleui.Page(bubbleui.PageConfig{
        Width:      m.width,
        Height:     m.height,
        Breadcrumb: "Home",
        Title:      "DASHBOARD",
        Content:    content,
        Shortcuts: []string{
            bubbleui.RenderShortcut("s", "settings"),
            bubbleui.RenderShortcut("q", "quit"),
        },
        Theme: &m.theme,
    })
}

func (m model) renderSettings() string {
    items := [][]string{
        {"Theme", "Dark"},
        {"Language", "English"},
        {"Notifications", "Enabled"},
    }

    table := bubbleui.Table(bubbleui.TableConfig{
        Width:   bubbleui.InnerWidth(m.width) - 4,
        Headers: []string{"SETTING", "VALUE"},
        Widths:  []int{30, 20},
        Rows:    items,
        Cursor:  0,
        Theme:   &m.theme,
    })

    return bubbleui.Page(bubbleui.PageConfig{
        Width:      m.width,
        Height:     m.height,
        Breadcrumb: "Home › Settings",
        Title:      "SETTINGS",
        Content:    table,
        Shortcuts: []string{
            bubbleui.RenderShortcut("↑↓", "navigate"),
            bubbleui.RenderShortcut("d", "delete"),
            bubbleui.RenderShortcut("Esc", "back"),
        },
        Theme: &m.theme,
    })
}

func (m model) renderConfirmDelete() string {
    // Get item data from router
    itemName := "Default Item"
    if data := m.router.CurrentData(); data != nil {
        if name, ok := data.(string); ok {
            itemName = name
        }
    }

    modal := bubbleui.ConfirmModal(bubbleui.ConfirmModalConfig{
        Width:      bubbleui.InnerWidth(m.width) - 4,
        Warning:    "You are about to delete the following item:",
        DangerText: "This action cannot be undone.",
        Items: []bubbleui.ConfirmModalItem{
            {Label: "Name", Value: itemName},
        },
        ConfirmWord: "delete",
        InputView:   "[                    ]", // Placeholder, use textinput.Model
        Theme:       &m.theme,
    })

    return bubbleui.Page(bubbleui.PageConfig{
        Width:      m.width,
        Height:     m.height,
        Breadcrumb: "Home › Settings › Delete",
        Title:      "CONFIRM DELETE",
        Content:    modal,
        Shortcuts: []string{
            bubbleui.RenderShortcut("⏎", "confirm"),
            bubbleui.RenderShortcut("Esc", "cancel"),
        },
        Theme: &m.theme,
    })
}

func (m model) updateCurrentScreen(msg tea.Msg) (tea.Model, tea.Cmd) {
    // Handle screen-specific updates
    switch m.router.Current() {
    case HomeScreen:
        if keyMsg, ok := msg.(tea.KeyMsg); ok {
            switch keyMsg.String() {
            case "s":
                return m, bubblenav.NavigateCmd(SettingsScreen, nil, false)
            case "q":
                return m, tea.Quit
            }
        }

    case SettingsScreen:
        if keyMsg, ok := msg.(tea.KeyMsg); ok {
            switch keyMsg.String() {
            case "d":
                // Navigate to confirm delete
                return m, bubblenav.NavigateCmd(ConfirmDeleteScreen, "Theme Setting", false)
            case "esc":
                return m, bubblenav.GoBackCmd()
            }
        }

    case ConfirmDeleteScreen:
        if keyMsg, ok := msg.(tea.KeyMsg); ok {
            switch keyMsg.String() {
            case "enter":
                // Delete confirmed, go back and show toast
                return m, tea.Batch(
                    bubblenav.NavigateCmd(SettingsScreen, nil, true), // Replace history
                    func() tea.Msg {
                        return bubbleui.ShowSuccess("Item deleted successfully")
                    },
                )
            case "esc":
                return m, bubblenav.GoBackCmd()
            }
        }
    }

    return m, nil
}

func (m model) initCurrentScreen() tea.Cmd {
    // Initialize screen-specific state when navigating
    return nil
}

func toastTick() tea.Cmd {
    return tea.Tick(100*time.Millisecond, func(t time.Time) tea.Msg {
        return bubbleui.TickMsg(t)
    })
}

func main() {
    p := tea.NewProgram(
        initialModel(),
        tea.WithAltScreen(),
        tea.WithMouseCellMotion(),
    )

    if _, err := p.Run(); err != nil {
        panic(err)
    }
}
```

## Key Patterns

### 1. Navigation with Replace

Use `ReplaceHistory: true` for success/confirmation screens:

```go
// After action completes, replace history to prevent going back
return m, tea.Batch(
    bubblenav.NavigateCmd(ListScreen, nil, true),
    func() tea.Msg {
        return bubbleui.ShowSuccess("Action completed")
    },
)
```

### 2. Data Passing

Pass data between screens:

```go
// Navigate with data
return m, bubblenav.NavigateCmd(EditScreen, userID, false)

// Receive data in target screen
case bubblenav.NavigateMsg[Screen]:
    if msg.Screen == EditScreen {
        if userID, ok := msg.Data.(int); ok {
            m.editUserID = userID
        }
    }

// Or query from router
userID := m.router.CurrentData().(int)
```

### 3. Toast After Navigation

Combine navigation and toast for feedback:

```go
return m, tea.Batch(
    bubblenav.NavigateCmd(HomeScreen, nil, true),
    func() tea.Msg {
        return bubbleui.ShowSuccess("Settings saved")
    },
)
```

### 4. Themed Components

Share theme across all layout components:

```go
theme := bubbleui.DefaultTheme()

// Use in all components
card := bubbleui.Card(bubbleui.CardConfig{
    Theme: &theme,
    // ...
})

page := bubbleui.Page(bubbleui.PageConfig{
    Theme: &theme,
    // ...
})
```

## Installation

```bash
cd packages
go work init
go work use bubblenav bubbleui

# In your project
go get github.com/buntime/bubblenav
go get github.com/buntime/bubbleui
```

## Publishing

Each package can be published independently:

```bash
cd packages/bubblenav
git tag bubblenav/v0.1.0
git push origin bubblenav/v0.1.0

cd ../bubbleui
git tag bubbleui/v0.1.0
git push origin bubbleui/v0.1.0
```

Or publish all together:

```bash
git tag packages/v0.1.0
git push origin packages/v0.1.0
```

## License

MIT
