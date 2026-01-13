// Package bubblenav provides a stack-based navigation system for Bubble Tea applications.
//
// It manages screen history, navigation flow, and routing between different views.
// The router supports push/pop operations, history replacement, and screen data passing.
//
// Example usage:
//
//	type MyScreen int
//	const (
//	    HomeScreen MyScreen = iota
//	    SettingsScreen
//	    ProfileScreen
//	)
//
//	router := bubblenav.New[MyScreen](HomeScreen)
//	router.Push(SettingsScreen, nil)
//	router.Replace(ProfileScreen, userData)
//	screen, data := router.Pop()
package bubblenav

import tea "github.com/charmbracelet/bubbletea"

// Screen is a constraint for types that can be used as screen identifiers.
// Typically an enum (int) or string.
type Screen interface {
	~int | ~string
}

// Router manages navigation history using a stack-based approach.
// It is generic over the screen type S.
type Router[S Screen] struct {
	current S
	history []S
	data    map[S]interface{}
}

// New creates a new router with the given initial screen.
func New[S Screen](initial S) *Router[S] {
	return &Router[S]{
		current: initial,
		history: []S{},
		data:    make(map[S]interface{}),
	}
}

// Current returns the current screen.
func (r *Router[S]) Current() S {
	return r.current
}

// History returns a copy of the navigation history stack.
func (r *Router[S]) History() []S {
	history := make([]S, len(r.history))
	copy(history, r.history)
	return history
}

// Data returns the data associated with the given screen.
func (r *Router[S]) Data(screen S) interface{} {
	return r.data[screen]
}

// CurrentData returns the data associated with the current screen.
func (r *Router[S]) CurrentData() interface{} {
	return r.data[r.current]
}

// Push navigates to a new screen, adding the current screen to the history stack.
// The data parameter can be used to pass information to the new screen.
func (r *Router[S]) Push(screen S, data interface{}) {
	// Don't push if navigating to the same screen
	if r.current != screen {
		r.history = append(r.history, r.current)
	}
	r.current = screen
	if data != nil {
		r.data[screen] = data
	}
}

// Pop navigates back to the previous screen in the history stack.
// Returns the previous screen and its associated data, or the current screen if history is empty.
func (r *Router[S]) Pop() (S, interface{}) {
	if len(r.history) == 0 {
		return r.current, r.data[r.current]
	}

	// Pop from history
	previous := r.history[len(r.history)-1]
	r.history = r.history[:len(r.history)-1]
	r.current = previous

	return r.current, r.data[r.current]
}

// Replace navigates to a new screen, replacing the current screen in the history.
// This is useful for preventing the user from going back to certain screens (e.g., confirmation screens).
// The last screen in history is replaced with the current screen before navigating.
func (r *Router[S]) Replace(screen S, data interface{}) {
	if len(r.history) > 0 {
		// Replace the last history entry with the current screen
		r.history[len(r.history)-1] = r.current
	}
	r.current = screen
	if data != nil {
		r.data[screen] = data
	}
}

// Reset clears the history and navigates to the given screen.
// Useful for logging out or returning to a root screen.
func (r *Router[S]) Reset(screen S, data interface{}) {
	r.history = []S{}
	r.current = screen
	r.data = make(map[S]interface{})
	if data != nil {
		r.data[screen] = data
	}
}

// CanGoBack returns whether there is history to go back to.
func (r *Router[S]) CanGoBack() bool {
	return len(r.history) > 0
}

// Clear removes all navigation history but keeps the current screen.
func (r *Router[S]) Clear() {
	r.history = []S{}
}

// ClearData removes all stored screen data.
func (r *Router[S]) ClearData() {
	r.data = make(map[S]interface{})
}

// NavigateMsg is a Bubble Tea message for triggering navigation.
// Send this message to request a navigation action.
type NavigateMsg[S Screen] struct {
	Screen         S
	Data           interface{}
	ReplaceHistory bool // If true, replaces the current screen in history instead of pushing
}

// GoBackMsg is a Bubble Tea message for triggering a back navigation.
type GoBackMsg struct{}

// NavigateCmd creates a Bubble Tea command that sends a NavigateMsg.
func NavigateCmd[S Screen](screen S, data interface{}, replace bool) tea.Cmd {
	return func() tea.Msg {
		return NavigateMsg[S]{
			Screen:         screen,
			Data:           data,
			ReplaceHistory: replace,
		}
	}
}

// GoBackCmd creates a Bubble Tea command that sends a GoBackMsg.
func GoBackCmd() tea.Cmd {
	return func() tea.Msg {
		return GoBackMsg{}
	}
}
