## bubbleui

UI component kit for [Bubble Tea](https://github.com/charmbracelet/bubbletea) TUI applications.

## Features

- **Layout Components** - Page, Card, Modal, Table
- **Toast Notifications** - Auto-dismissing messages
- **Theming System** - Customizable colors and styles
- **Utilities** - Text centering, shortcuts, width calculation
- **Single Package** - Everything you need in one import

## Installation

```bash
go get github.com/buntime/bubbleui
```

## Quick Start

```go
package main

import (
    "time"

    "github.com/buntime/bubbleui"
    tea "github.com/charmbracelet/bubbletea"
)

type model struct {
    toast  *bubbleui.Toast
    theme  bubbleui.Theme
    width  int
    height int
}

func (m model) Init() tea.Cmd {
    return toastTick()
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    switch msg := msg.(type) {
    case tea.WindowSizeMsg:
        m.width = msg.Width
        m.height = msg.Height
        m.toast.SetWidth(msg.Width)

    case bubbleui.ToastTickMsg:
        m.toast.Update()
        return m, toastTick()

    case tea.KeyMsg:
        switch msg.String() {
        case "q":
            return m, tea.Quit
        case "s":
            m.toast.ShowSuccess("Operation completed!")
        }
    }
    return m, nil
}

func (m model) View() string {
    // Toast at top
    view := m.toast.View()

    // Content card
    content := bubbleui.Card(bubbleui.CardConfig{
        Width:   bubbleui.InnerWidth(m.width) - 4,
        Variant: bubbleui.CardSuccess,
        Content: "Press 's' for success toast",
        Theme:   &m.theme,
    })

    // Page layout
    view += bubbleui.Page(bubbleui.PageConfig{
        Width:      m.width,
        Height:     m.height,
        Title:      "MY APP",
        Content:    content,
        Shortcuts:  []string{
            bubbleui.RenderShortcut("s", "toast"),
            bubbleui.RenderShortcut("q", "quit"),
        },
        Theme:      &m.theme,
    })

    return view
}

func toastTick() tea.Cmd {
    return tea.Tick(100*time.Millisecond, func(t time.Time) tea.Msg {
        return bubbleui.ToastTickMsg(t)
    })
}

func main() {
    p := tea.NewProgram(model{
        toast: bubbleui.NewToast(),
        theme: bubbleui.DefaultTheme(),
    })
    p.Run()
}
```

## Components

### Page

Full-page layout with header, breadcrumb, content, and footer:

```go
page := bubbleui.Page(bubbleui.PageConfig{
    Width:      80,
    Height:     24,
    Breadcrumb: "Home › Settings",
    Title:      "USER SETTINGS",
    Content:    "Your content here...",
    Shortcuts:  []string{
        bubbleui.RenderShortcut("↑↓", "navigate"),
        bubbleui.RenderShortcut("⏎", "select"),
    },
    Theme: &theme,
})
```

### Card

Bordered container with style variants:

```go
// Default card
card := bubbleui.Card(bubbleui.CardConfig{
    Width:   60,
    Variant: bubbleui.CardDefault,
    Content: "Default content",
})

// Warning (yellow), Error (red), Success (green), Info (blue)
warning := bubbleui.Card(bubbleui.CardConfig{
    Width:   60,
    Variant: bubbleui.CardWarning,
    Content: "⚠ Be careful!",
})
```

### Confirmation Modal

Dangerous action confirmation with text input:

```go
modal := bubbleui.ConfirmModal(bubbleui.ConfirmModalConfig{
    Width:       60,
    Title:       "DELETE ITEM",
    Warning:     "You are about to delete:",
    DangerText:  "This cannot be undone.",
    Items:       []bubbleui.ConfirmModalItem{
        {Label: "Name", Value: "production-db"},
        {Label: "Type", Value: "PostgreSQL"},
    },
    ConfirmWord: "delete",
    InputView:   m.input.View(), // textinput.Model
})
```

### Table

Data table with cursor:

```go
table := bubbleui.Table(bubbleui.TableConfig{
    Width:   80,
    Headers: []string{"NAME", "STATUS", "CREATED"},
    Widths:  []int{20, 15, 20},
    Rows:    [][]string{
        {"my-app", "running", "2024-01-15"},
        {"worker-1", "stopped", "2024-01-14"},
    },
    Cursor:  0, // First row selected
})
```

### Toast

Auto-dismissing notifications:

```go
toast := bubbleui.NewToast()

// Show toasts (auto-hide after duration)
toast.ShowError("Connection failed")      // 5s
toast.ShowSuccess("Saved!")              // 3s
toast.ShowWarning("Low disk space")      // 4s
toast.ShowInfo("Update available")       // 3s

// Custom duration
toast.Show("Custom", bubbleui.ToastSuccess, 10*time.Second)

// Update periodically (check expiration)
case bubbleui.ToastTickMsg:
    toast.Update()
    return m, toastTick()

// Render (at top of screen)
view := toast.View() + otherContent
```

## Theming

Customize colors and styles:

```go
theme := bubbleui.DefaultTheme()

// Customize colors
theme.Primary = lipgloss.Color("#00D9FF")
theme.Error = lipgloss.Color("#FF0040")
theme.Success = lipgloss.Color("#00FF87")

// Use in all components
card := bubbleui.Card(bubbleui.CardConfig{
    Theme: &theme,
    // ...
})
```

## Utilities

```go
// Calculate inner width (minus padding)
innerWidth := bubbleui.InnerWidth(80) // 76

// Center text
centered := bubbleui.CenterText("Welcome!", 80)

// Format shortcuts
shortcut := bubbleui.RenderShortcut("⏎", "confirm")
// Output: [⏎] confirm
```

## Message-Based Toast

Use Bubble Tea messages for cleaner code:

```go
// In Update()
case bubbleui.ShowToastMsg:
    switch msg.Type {
    case bubbleui.ToastError:
        m.toast.ShowError(msg.Message)
    case bubbleui.ToastSuccess:
        m.toast.ShowSuccess(msg.Message)
    // ...
    }

// Send toast from anywhere
return m, func() tea.Msg {
    return bubbleui.ShowSuccessMsg("Item deleted")
}
```

## Complete Example

See [INTEGRATION_GUIDE.md](../INTEGRATION_GUIDE.md) for a full example with `bblrouter`.

## License

MIT
