package screens

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/buntime/cli/internal/api"
	"github.com/buntime/cli/internal/db"
	"github.com/buntime/cli/internal/tui/layout"
	"github.com/buntime/cli/internal/tui/styles"
	"github.com/charmbracelet/bubbles/filepicker"
	"github.com/charmbracelet/bubbles/progress"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
)

type installMode int

const (
	installModeSelect installMode = iota
	installModeFilePicker
	installModeDirPicker
	installModePathInput
	installModeUploading
	installModeSuccess
	installModeFailed
)

// fileEntry represents a file or directory entry
type fileEntry struct {
	name  string
	path  string
	isDir bool
	size  int64
}

// InstallModel handles file installation
type InstallModel struct {
	api        *api.Client
	server     *db.Server
	itemType   string // "app" or "plugin"
	mode       installMode
	filePicker filepicker.Model
	dirPicker  filepicker.Model
	pathInput  textinput.Model
	progress   progress.Model
	result     *api.InstallResult
	err        error
	pathErr    string
	width      int
	height     int
	selected   string
	tempFile   string

	// Filter-related fields
	filterInput   textinput.Model
	filterActive  bool
	currentDir    string
	allEntries    []fileEntry
	filteredList  []fileEntry
	filterCursor  int
	pickerHeight  int
}

// NewInstallModel creates an install screen
func NewInstallModel(client *api.Client, server *db.Server, itemType string, width, height int) *InstallModel {
	// File picker for .zip and .tgz files
	fp := filepicker.New()
	fp.AllowedTypes = []string{".zip", ".tgz", ".tar.gz"}
	fp.CurrentDirectory, _ = os.UserHomeDir()
	fp.Height = height - 12
	fp.ShowHidden = false
	fp.ShowPermissions = false
	fp.ShowSize = true
	fp.DirAllowed = false
	fp.FileAllowed = true

	// Directory picker
	dp := filepicker.New()
	dp.CurrentDirectory, _ = os.UserHomeDir()
	dp.Height = height - 12
	dp.ShowHidden = false
	dp.ShowPermissions = false
	dp.ShowSize = false
	dp.DirAllowed = true
	dp.FileAllowed = false

	// Path input for paste/typing
	pi := textinput.New()
	pi.Placeholder = "/path/to/file.zip or /path/to/directory"
	pi.Prompt = ""
	pi.CharLimit = 500
	pi.Width = 60

	prog := progress.New(progress.WithDefaultGradient())
	prog.Width = 50

	// Filter input
	fi := textinput.New()
	fi.Placeholder = "Type to filter..."
	fi.Prompt = "🔍 "
	fi.CharLimit = 100
	fi.Width = 40

	homeDir, _ := os.UserHomeDir()

	return &InstallModel{
		api:          client,
		server:       server,
		itemType:     itemType,
		mode:         installModeSelect,
		filePicker:   fp,
		dirPicker:    dp,
		pathInput:    pi,
		progress:     prog,
		width:        width,
		height:       height,
		filterInput:  fi,
		currentDir:   homeDir,
		pickerHeight: height - 14,
	}
}

func (m *InstallModel) Init() tea.Cmd {
	return tea.Batch(m.filePicker.Init(), m.dirPicker.Init())
}

// loadDirectory reads directory contents and populates allEntries
func (m *InstallModel) loadDirectory(forFiles bool) {
	entries, err := os.ReadDir(m.currentDir)
	if err != nil {
		m.allEntries = nil
		m.filteredList = nil
		return
	}

	m.allEntries = make([]fileEntry, 0, len(entries)+1)

	// Add parent directory entry if not at root
	if m.currentDir != "/" {
		m.allEntries = append(m.allEntries, fileEntry{
			name:  "..",
			path:  filepath.Dir(m.currentDir),
			isDir: true,
		})
	}

	allowedExts := map[string]bool{".zip": true, ".tgz": true, ".gz": true}

	for _, entry := range entries {
		// Skip hidden files
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		isDir := entry.IsDir()
		entryPath := filepath.Join(m.currentDir, entry.Name())

		// For file picker mode, only show directories and allowed file types
		if forFiles && !isDir {
			ext := strings.ToLower(filepath.Ext(entry.Name()))
			// Handle .tar.gz
			if strings.HasSuffix(strings.ToLower(entry.Name()), ".tar.gz") {
				ext = ".gz"
			}
			if !allowedExts[ext] {
				continue
			}
		}

		// For dir picker mode, only show directories
		if !forFiles && !isDir {
			continue
		}

		m.allEntries = append(m.allEntries, fileEntry{
			name:  entry.Name(),
			path:  entryPath,
			isDir: isDir,
			size:  info.Size(),
		})
	}

	m.applyFilter()
}

// applyFilter filters allEntries based on filterInput value
func (m *InstallModel) applyFilter() {
	filter := strings.ToLower(strings.TrimSpace(m.filterInput.Value()))

	if filter == "" {
		m.filteredList = m.allEntries
	} else {
		m.filteredList = make([]fileEntry, 0)
		for _, entry := range m.allEntries {
			// Always show parent directory
			if entry.name == ".." {
				m.filteredList = append(m.filteredList, entry)
				continue
			}
			if strings.Contains(strings.ToLower(entry.name), filter) {
				m.filteredList = append(m.filteredList, entry)
			}
		}
	}

	// Reset cursor if out of bounds
	if m.filterCursor >= len(m.filteredList) {
		m.filterCursor = len(m.filteredList) - 1
	}
	if m.filterCursor < 0 {
		m.filterCursor = 0
	}
}

// navigateToDir changes current directory and reloads entries
func (m *InstallModel) navigateToDir(path string, forFiles bool) {
	m.currentDir = path
	m.filterInput.SetValue("")
	m.filterCursor = 0
	m.loadDirectory(forFiles)
}

func (m *InstallModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.filePicker.Height = msg.Height - 12
		m.dirPicker.Height = msg.Height - 12
		m.pickerHeight = msg.Height - 14
		return m, nil

	case tea.KeyMsg:
		// Handle success/failure states
		if m.mode == installModeSuccess || m.mode == installModeFailed {
			// Cleanup temp file if exists
			if m.tempFile != "" {
				os.Remove(m.tempFile)
				m.tempFile = ""
			}
			// Navigate back to the appropriate list screen, replacing history
			targetScreen := ScreenApps
			if m.itemType == "plugin" {
				targetScreen = ScreenPlugins
			}
			return m, func() tea.Msg {
				return NavigateMsg{Screen: targetScreen, Data: nil, ReplaceHistory: true}
			}
		}

		// Handle mode selection
		if m.mode == installModeSelect {
			switch msg.String() {
			case "1", "f":
				m.mode = installModeFilePicker
				m.filterActive = true
				m.filterInput.Focus()
				m.loadDirectory(true) // forFiles = true
				return m, textinput.Blink
			case "2", "d":
				m.mode = installModeDirPicker
				m.filterActive = true
				m.filterInput.Focus()
				m.loadDirectory(false) // forFiles = false
				return m, textinput.Blink
			case "3", "p":
				m.mode = installModePathInput
				m.pathInput.Focus()
				m.pathErr = ""
				return m, textinput.Blink
			case "esc", "q":
				// Navigate back to the appropriate list screen, replacing history
				targetScreen := ScreenApps
				if m.itemType == "plugin" {
					targetScreen = ScreenPlugins
				}
				return m, func() tea.Msg {
					return NavigateMsg{Screen: targetScreen, Data: nil, ReplaceHistory: true}
				}
			}
			return m, nil
		}

		// Handle file/dir picker with filter
		if m.mode == installModeFilePicker || m.mode == installModeDirPicker {
			forFiles := m.mode == installModeFilePicker

			switch msg.String() {
			case "esc":
				m.mode = installModeSelect
				m.filterActive = false
				m.filterInput.Blur()
				m.filterInput.SetValue("")
				return m, nil

			case "up", "ctrl+p":
				if m.filterCursor > 0 {
					m.filterCursor--
				}
				return m, nil

			case "down", "ctrl+n":
				if m.filterCursor < len(m.filteredList)-1 {
					m.filterCursor++
				}
				return m, nil

			case "enter", "right":
				if len(m.filteredList) > 0 && m.filterCursor < len(m.filteredList) {
					entry := m.filteredList[m.filterCursor]
					if entry.isDir {
						m.navigateToDir(entry.path, forFiles)
						return m, nil
					}
					// File selected - install it
					if forFiles {
						m.selected = entry.path
						return m, m.install(entry.path)
					}
				}
				return m, nil

			case "left", "backspace":
				// If filter is empty and backspace/left pressed, go to parent
				if m.filterInput.Value() == "" && m.currentDir != "/" {
					m.navigateToDir(filepath.Dir(m.currentDir), forFiles)
					return m, nil
				}
				// Otherwise let the textinput handle backspace
				if msg.String() == "left" {
					m.navigateToDir(filepath.Dir(m.currentDir), forFiles)
					return m, nil
				}

			case "i":
				// Install current directory (only in dir picker mode)
				if m.mode == installModeDirPicker {
					m.selected = m.currentDir
					return m, m.installDirectory(m.currentDir)
				}
			}

			// Update filter input for any other keys
			var cmd tea.Cmd
			m.filterInput, cmd = m.filterInput.Update(msg)
			m.applyFilter()
			return m, cmd
		}

		// Handle path input
		if m.mode == installModePathInput {
			switch msg.String() {
			case "esc":
				m.mode = installModeSelect
				m.pathInput.Blur()
				return m, nil
			case "enter":
				return m, m.submitPath()
			}
		}

		// Can't interact while uploading
		if m.mode == installModeUploading {
			return m, nil
		}

	case installProgressMsg:
		return m, m.progress.SetPercent(msg.percent)

	case installResultMsg:
		if msg.err != nil {
			m.mode = installModeFailed
			m.err = msg.err
			return m, nil
		}
		m.mode = installModeSuccess
		m.result = msg.result
		return m, nil

	case progress.FrameMsg:
		progressModel, cmd := m.progress.Update(msg)
		m.progress = progressModel.(progress.Model)
		return m, cmd
	}

	// Update path input
	if m.mode == installModePathInput {
		var cmd tea.Cmd
		m.pathInput, cmd = m.pathInput.Update(msg)
		return m, cmd
	}

	return m, nil
}

func (m *InstallModel) submitPath() tea.Cmd {
	path := strings.TrimSpace(m.pathInput.Value())
	if path == "" {
		m.pathErr = "Path cannot be empty"
		return nil
	}

	// Expand ~ to home directory
	if strings.HasPrefix(path, "~/") {
		home, _ := os.UserHomeDir()
		path = filepath.Join(home, path[2:])
	}

	// Check if path exists
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			m.pathErr = "Path does not exist"
		} else {
			m.pathErr = "Cannot access path: " + err.Error()
		}
		return nil
	}

	m.selected = path

	if info.IsDir() {
		// Directory - zip and upload
		return m.installDirectory(path)
	}

	// File - check extension
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".zip" && ext != ".tgz" && !strings.HasSuffix(strings.ToLower(path), ".tar.gz") {
		m.pathErr = "File must be .zip, .tgz, or .tar.gz"
		return nil
	}

	return m.install(path)
}

func (m *InstallModel) install(path string) tea.Cmd {
	m.mode = installModeUploading
	m.err = nil

	return func() tea.Msg {
		var result *api.InstallResult
		var err error

		if m.itemType == "app" {
			result, err = m.api.InstallApp(path)
		} else {
			result, err = m.api.InstallPlugin(path)
		}

		if err != nil {
			return installResultMsg{err: err}
		}
		return installResultMsg{result: result}
	}
}

func (m *InstallModel) installDirectory(dirPath string) tea.Cmd {
	m.mode = installModeUploading
	m.err = nil

	return func() tea.Msg {
		// Create temp zip file
		tempFile, err := os.CreateTemp("", "buntime-*.zip")
		if err != nil {
			return installResultMsg{err: fmt.Errorf("failed to create temp file: %w", err)}
		}
		tempPath := tempFile.Name()
		m.tempFile = tempPath

		// Create zip archive
		zipWriter := zip.NewWriter(tempFile)

		err = filepath.Walk(dirPath, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}

			// Get relative path
			relPath, err := filepath.Rel(dirPath, path)
			if err != nil {
				return err
			}

			// Skip root directory
			if relPath == "." {
				return nil
			}

			// Skip hidden files and directories
			if strings.HasPrefix(filepath.Base(path), ".") {
				if info.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}

			// Skip node_modules
			if info.IsDir() && info.Name() == "node_modules" {
				return filepath.SkipDir
			}

			// Create header
			header, err := zip.FileInfoHeader(info)
			if err != nil {
				return err
			}
			header.Name = relPath
			header.Method = zip.Deflate

			if info.IsDir() {
				header.Name += "/"
				_, err = zipWriter.CreateHeader(header)
				return err
			}

			// Write file
			writer, err := zipWriter.CreateHeader(header)
			if err != nil {
				return err
			}

			file, err := os.Open(path)
			if err != nil {
				return err
			}
			defer file.Close()

			_, err = io.Copy(writer, file)
			return err
		})

		zipWriter.Close()
		tempFile.Close()

		if err != nil {
			os.Remove(tempPath)
			return installResultMsg{err: fmt.Errorf("failed to create zip: %w", err)}
		}

		// Upload the zip
		var result *api.InstallResult
		if m.itemType == "app" {
			result, err = m.api.InstallApp(tempPath)
		} else {
			result, err = m.api.InstallPlugin(tempPath)
		}

		// Cleanup temp file
		os.Remove(tempPath)
		m.tempFile = ""

		if err != nil {
			return installResultMsg{err: err}
		}
		return installResultMsg{result: result}
	}
}

type installProgressMsg struct {
	percent float64
}

type installResultMsg struct {
	result *api.InstallResult
	err    error
}

func (m *InstallModel) View() string {
	innerWidth := layout.InnerWidth(m.width)
	titleText := fmt.Sprintf("INSTALL %s", strings.ToUpper(m.itemType))

	breadcrumb := "Main › Apps › Install"
	if m.itemType == "plugin" {
		breadcrumb = "Main › Plugins › Install"
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

func (m *InstallModel) renderContent(width int) string {
	switch m.mode {
	case installModeSelect:
		return m.renderModeSelect()
	case installModeFilePicker:
		return m.renderFilePicker()
	case installModeDirPicker:
		return m.renderDirPicker()
	case installModePathInput:
		return m.renderPathInput(width)
	case installModeUploading:
		return m.renderUploading()
	case installModeSuccess:
		return m.renderSuccess(width)
	case installModeFailed:
		return m.renderFailed(width)
	default:
		return ""
	}
}

func (m *InstallModel) renderModeSelect() string {
	var b strings.Builder

	b.WriteString(styles.TextMuted.Render("Select installation source:") + "\n\n")

	// Option 1: File
	opt1 := styles.TextNormal.Render("[1] ") + styles.TextPrimary.Render("Select File") +
		styles.TextMuted.Render(" (.zip, .tgz)")
	b.WriteString(opt1 + "\n")
	b.WriteString(styles.TextMuted.Render("    Choose an existing archive file") + "\n\n")

	// Option 2: Directory
	opt2 := styles.TextNormal.Render("[2] ") + styles.TextPrimary.Render("Select Directory") +
		styles.TextMuted.Render(" (auto-compress)")
	b.WriteString(opt2 + "\n")
	b.WriteString(styles.TextMuted.Render("    Choose a folder to compress and upload") + "\n\n")

	// Option 3: Paste/Type Path
	opt3 := styles.TextNormal.Render("[3] ") + styles.TextPrimary.Render("Paste/Type Path")
	b.WriteString(opt3 + "\n")
	b.WriteString(styles.TextMuted.Render("    Enter a file or directory path directly") + "\n")

	return b.String()
}

func (m *InstallModel) renderPathInput(width int) string {
	var b strings.Builder

	b.WriteString(styles.TextMuted.Render("Enter the path to a .zip/.tgz file or a directory:") + "\n\n")

	// Input field with consistent styling
	b.WriteString(styles.RenderInput(m.pathInput.View(), true, m.pathErr != "") + "\n")

	// Error message
	if m.pathErr != "" {
		b.WriteString(styles.TextError.Render("Error: "+m.pathErr) + "\n")
	}

	b.WriteString("\n")
	b.WriteString(styles.TextMuted.Render("Tip: Use ~ for home directory (e.g., ~/projects/my-app)") + "\n")

	return b.String()
}

func (m *InstallModel) renderFilePicker() string {
	return m.renderFilteredPicker(true)
}

func (m *InstallModel) renderDirPicker() string {
	return m.renderFilteredPicker(false)
}

func (m *InstallModel) renderFilteredPicker(forFiles bool) string {
	var b strings.Builder

	// Current directory
	b.WriteString(styles.TextMuted.Render("Directory: ") +
		styles.TextNormal.Render(m.currentDir) + "\n\n")

	// Filter input with consistent styling
	b.WriteString(styles.RenderInput(m.filterInput.View(), true, false) + "\n\n")

	// File/directory list
	if len(m.filteredList) == 0 {
		if m.filterInput.Value() != "" {
			b.WriteString(styles.TextMuted.Render("No matches found") + "\n")
		} else {
			b.WriteString(styles.TextMuted.Render("Empty directory") + "\n")
		}
	} else {
		// Calculate visible range for scrolling
		visibleHeight := m.pickerHeight
		if visibleHeight < 5 {
			visibleHeight = 5
		}

		startIdx := 0
		if m.filterCursor >= visibleHeight {
			startIdx = m.filterCursor - visibleHeight + 1
		}
		endIdx := startIdx + visibleHeight
		if endIdx > len(m.filteredList) {
			endIdx = len(m.filteredList)
		}

		for i := startIdx; i < endIdx; i++ {
			entry := m.filteredList[i]

			cursor := "  "
			if i == m.filterCursor {
				cursor = styles.Caret
			}

			icon := "📄"
			if entry.isDir {
				icon = "📁"
			}
			if entry.name == ".." {
				icon = "⬆️"
			}

			name := entry.name
			if entry.isDir && entry.name != ".." {
				name += "/"
			}

			// Format size for files
			sizeStr := ""
			if !entry.isDir && forFiles {
				sizeStr = "  " + styles.TextMuted.Render(formatSize(entry.size))
			}

			line := icon + " " + name + sizeStr

			if i == m.filterCursor {
				line = icon + " " + styles.TextPrimary.Render(name) + sizeStr
			}

			b.WriteString(cursor + line + "\n")
		}

		// Show scroll indicator if needed
		if len(m.filteredList) > visibleHeight {
			b.WriteString(styles.TextMuted.Render(fmt.Sprintf("\n  (%d of %d items)", m.filterCursor+1, len(m.filteredList))) + "\n")
		}
	}

	return b.String()
}

func formatSize(size int64) string {
	const (
		KB = 1024
		MB = KB * 1024
		GB = MB * 1024
	)

	switch {
	case size >= GB:
		return fmt.Sprintf("%.1f GB", float64(size)/float64(GB))
	case size >= MB:
		return fmt.Sprintf("%.1f MB", float64(size)/float64(MB))
	case size >= KB:
		return fmt.Sprintf("%.1f KB", float64(size)/float64(KB))
	default:
		return fmt.Sprintf("%d B", size)
	}
}

func (m *InstallModel) renderUploading() string {
	var b strings.Builder

	b.WriteString(styles.TextPrimary.Render("UPLOADING...") + "\n\n")

	// Source name
	sourceName := filepath.Base(m.selected)
	b.WriteString(styles.TextMuted.Render("Source: ") +
		styles.TextNormal.Render(sourceName) + "\n\n")

	// Progress bar
	b.WriteString(m.progress.View() + "\n\n")

	// Steps
	steps := []string{
		styles.TextSuccess.Render("✓") + " " + styles.TextNormal.Render("Preparing files"),
		styles.TextPrimary.Render("⠋") + " " + styles.TextNormal.Render("Uploading to server..."),
		styles.TextMuted.Render("○") + " " + styles.TextMuted.Render("Extracting files"),
		styles.TextMuted.Render("○") + " " + styles.TextMuted.Render("Registering " + m.itemType),
	}

	for _, step := range steps {
		b.WriteString(step + "\n")
	}

	return b.String()
}

func (m *InstallModel) renderSuccess(width int) string {
	var b strings.Builder

	b.WriteString(layout.CenterText(styles.TextSuccess.Bold(true).Render("✓ INSTALLATION COMPLETE"), width) + "\n")
	b.WriteString("\n")

	if m.result != nil {
		b.WriteString(styles.TextNormal.Render("Name: "+m.result.Name) + "\n")
		b.WriteString(styles.TextNormal.Render("Version: "+m.result.Version) + "\n")
		b.WriteString(styles.TextNormal.Render("Path: "+m.result.Path) + "\n")
	}

	b.WriteString("\n")
	b.WriteString(styles.TextMuted.Render("Press any key to continue") + "\n")

	return b.String()
}

func (m *InstallModel) renderFailed(width int) string {
	var b strings.Builder

	b.WriteString(layout.CenterText(styles.TextError.Bold(true).Render("✗ INSTALLATION FAILED"), width) + "\n")
	b.WriteString("\n")

	if m.err != nil {
		// Wrap error message to fit width
		errMsg := m.err.Error()
		maxWidth := width - 8 // Account for padding
		if maxWidth < 40 {
			maxWidth = 40
		}

		// Split into lines if too long
		words := strings.Fields(errMsg)
		var lines []string
		var currentLine string

		for _, word := range words {
			testLine := currentLine
			if testLine != "" {
				testLine += " "
			}
			testLine += word

			if len(testLine) <= maxWidth {
				currentLine = testLine
			} else {
				if currentLine != "" {
					lines = append(lines, currentLine)
				}
				currentLine = word
			}
		}
		if currentLine != "" {
			lines = append(lines, currentLine)
		}

		for _, line := range lines {
			b.WriteString(styles.TextError.Render(line) + "\n")
		}
	}

	b.WriteString("\n")
	b.WriteString(styles.TextMuted.Render("Press any key to go back") + "\n")

	return b.String()
}

func (m *InstallModel) getShortcuts() []string {
	switch m.mode {
	case installModeSelect:
		return []string{
			styles.RenderShortcut("1/f", "file"),
			styles.RenderShortcut("2/d", "directory"),
			styles.RenderShortcut("3/p", "paste path"),
			styles.RenderShortcut("Esc", "cancel"),
		}
	case installModeFilePicker:
		return []string{
			styles.RenderShortcut("type", "filter"),
			styles.RenderShortcut("↑↓", "navigate"),
			styles.RenderShortcut("⏎", "select"),
			styles.RenderShortcut("←", "parent"),
			styles.RenderShortcut("Esc", "back"),
		}
	case installModeDirPicker:
		return []string{
			styles.RenderShortcut("type", "filter"),
			styles.RenderShortcut("↑↓", "navigate"),
			styles.RenderShortcut("⏎/→", "open"),
			styles.RenderShortcut("←", "parent"),
			styles.RenderShortcut("i", "install"),
			styles.RenderShortcut("Esc", "back"),
		}
	case installModePathInput:
		return []string{
			styles.RenderShortcut("⏎", "submit"),
			styles.RenderShortcut("Esc", "back"),
		}
	case installModeUploading:
		return []string{
			styles.RenderShortcut("", "Please wait..."),
		}
	default:
		return []string{
			styles.RenderShortcut("any key", "continue"),
		}
	}
}
