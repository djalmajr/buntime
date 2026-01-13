package styles

import "github.com/charmbracelet/lipgloss"

// ASCII art logo
const LogoArt = `██████╗ ██╗   ██╗███╗   ██╗████████╗██╗███╗   ███╗███████╗
██╔══██╗██║   ██║████╗  ██║╚══██╔══╝██║████╗ ████║██╔════╝
██████╔╝██║   ██║██╔██╗ ██║   ██║   ██║██╔████╔██║█████╗
██╔══██╗██║   ██║██║╚██╗██║   ██║   ██║██║╚██╔╝██║██╔══╝
██████╔╝╚██████╔╝██║ ╚████║   ██║   ██║██║ ╚═╝ ██║███████╗
╚═════╝  ╚═════╝ ╚═╝  ╚═══╝   ╚═╝   ╚═╝╚═╝     ╚═╝╚══════╝`

// Smaller logo for narrow terminals
const LogoSmall = `┏┓   ┏┓•
┣┫┓┏┏┓╋┓┏┳┓┏┓
┗┛┗┻┛┗┗┗┛┗┗┗ `

var (
	LogoStyle = lipgloss.NewStyle().
			Foreground(ColorPrimary).
			Bold(true)

	LogoSubtitle = lipgloss.NewStyle().
			Foreground(ColorMuted).
			Align(lipgloss.Center)
)

func RenderLogo(width int) string {
	logo := LogoArt
	if width < 70 {
		logo = LogoSmall
	}

	return lipgloss.JoinVertical(
		lipgloss.Center,
		LogoStyle.Render(logo),
		"",
		LogoSubtitle.Render("Runtime Worker Pool Manager"),
	)
}
