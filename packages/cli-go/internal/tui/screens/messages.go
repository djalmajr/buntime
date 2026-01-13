package screens

import (
	"github.com/buntime/cli/internal/api"
	"github.com/buntime/cli/internal/db"
	tea "github.com/charmbracelet/bubbletea"
)

// ConnectedMsg indicates successful connection
type ConnectedMsg struct {
	Client *api.Client
	Server *db.Server
}

// GoBackMsg indicates navigation back
type GoBackMsg struct{}

// goBack returns a command to navigate back
func goBack() tea.Cmd {
	return func() tea.Msg {
		return GoBackMsg{}
	}
}
