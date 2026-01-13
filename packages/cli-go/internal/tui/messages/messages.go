package messages

import (
	"time"

	"github.com/buntime/cli/internal/db"
	"github.com/buntime/cli/internal/tui/components"
)

// ShowToastMsg triggers showing a toast notification
type ShowToastMsg struct {
	Message string
	Type    components.ToastType
}

// ToastTickMsg is sent periodically to check toast expiration
type ToastTickMsg time.Time

// ServerSavedMsg is sent when a server is saved
type ServerSavedMsg struct {
	Server *db.Server
	Err    error
}

// Helper functions to create toast messages
func ShowError(message string) ShowToastMsg {
	return ShowToastMsg{Message: message, Type: components.ToastError}
}

func ShowSuccess(message string) ShowToastMsg {
	return ShowToastMsg{Message: message, Type: components.ToastSuccess}
}

func ShowWarning(message string) ShowToastMsg {
	return ShowToastMsg{Message: message, Type: components.ToastWarning}
}

func ShowInfo(message string) ShowToastMsg {
	return ShowToastMsg{Message: message, Type: components.ToastInfo}
}
