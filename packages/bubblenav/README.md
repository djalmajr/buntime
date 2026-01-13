# bubblenav

Stack-based navigation router for [Bubble Tea](https://github.com/charmbracelet/bubbletea) TUI applications.

## Features

- **Type-safe routing** with Go generics
- **Stack-based history** for back navigation
- **Screen data passing** between routes
- **History manipulation** (push, pop, replace, reset)
- **Zero dependencies** except Bubble Tea

## Installation

```bash
go get github.com/buntime/bubblenav
```

## Quick Start

```go
package main

import (
    "github.com/buntime/bubblenav"
    tea "github.com/charmbracelet/bubbletea"
)

// Define your screens as an enum
type Screen int

const (
    HomeScreen Screen = iota
    SettingsScreen
    ProfileScreen
)

type model struct {
    router *bubblenav.Router[Screen]
    // ... your screen models
}

func (m model) Init() tea.Cmd {
    return nil
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    switch msg := msg.(type) {
    case tea.KeyMsg:
        if msg.String() == "q" {
            return m, tea.Quit
        }

    // Handle navigation messages
    case bubblenav.NavigateMsg[Screen]:
        if msg.ReplaceHistory {
            m.router.Replace(msg.Screen, msg.Data)
        } else {
            m.router.Push(msg.Screen, msg.Data)
        }
        return m, nil

    case bubblenav.GoBackMsg:
        m.router.Pop()
        return m, nil
    }

    return m, nil
}

func (m model) View() string {
    switch m.router.Current() {
    case HomeScreen:
        return "Home Screen"
    case SettingsScreen:
        return "Settings Screen"
    case ProfileScreen:
        return "Profile Screen"
    default:
        return "Unknown Screen"
    }
}

func main() {
    router := bubblenav.New(HomeScreen)
    p := tea.NewProgram(model{router: router})
    p.Run()
}
```

## API Reference

### Creating a Router

```go
router := bubblenav.New[MyScreen](InitialScreen)
```

### Navigation Methods

#### Push
Navigate to a new screen, adding current screen to history:
```go
router.Push(SettingsScreen, nil)
router.Push(ProfileScreen, userData)
```

#### Pop
Go back to the previous screen:
```go
screen, data := router.Pop()
```

#### Replace
Navigate to a screen, replacing the current screen in history:
```go
// Useful for login flows - prevent going back to login after success
router.Replace(DashboardScreen, nil)
```

#### Reset
Clear all history and navigate to a screen:
```go
// Logout or return to root
router.Reset(LoginScreen, nil)
```

### Querying State

```go
current := router.Current()                 // Current screen
canGoBack := router.CanGoBack()             // Has history?
history := router.History()                 // Copy of history stack
data := router.Data(SomeScreen)             // Data for a screen
currentData := router.CurrentData()         // Data for current screen
```

### Bubble Tea Messages

Send navigation commands:

```go
// Navigate to a screen
return m, bubblenav.NavigateCmd(SettingsScreen, nil, false)

// Navigate and replace history (prevent back)
return m, bubblenav.NavigateCmd(DashboardScreen, nil, true)

// Go back
return m, bubblenav.GoBackCmd()
```

## Patterns

### Passing Data Between Screens

```go
// Screen A: Navigate with data
type UserData struct {
    ID   int
    Name string
}

return m, bubblenav.NavigateCmd(ProfileScreen, UserData{ID: 123, Name: "Alice"}, false)

// Screen B: Receive data
case bubblenav.NavigateMsg[Screen]:
    if msg.Screen == ProfileScreen {
        if userData, ok := msg.Data.(UserData); ok {
            // Use userData
        }
    }
```

### Preventing Back Navigation

Use `Replace` for confirmation screens or success pages:

```go
// After deleting an item, prevent going back to delete confirmation
m.router.Replace(ListScreen, nil)
```

### Modal/Dialog Pattern

Keep modals in history so ESC can close them:

```go
case "d": // Delete key
    return m, bubblenav.NavigateCmd(ConfirmDeleteScreen, item, false)

case bubblenav.GoBackMsg:
    // ESC will close the modal and return to list
    m.router.Pop()
```

## Why Stack-Based?

Stack-based navigation is natural for TUIs:
- **ESC = Back** is intuitive
- **Breadcrumbs** map to history stack
- **Modal dialogs** naturally push/pop
- **Linear flows** (wizards, forms) work well

## License

MIT
