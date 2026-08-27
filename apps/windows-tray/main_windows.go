//go:build windows

package main

import (
	"fmt"
	"net/url"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const (
	wmTray      = 0x8001
	wmRefresh   = 0x8002
	wmOperation = 0x8003

	wmCreate    = 0x0001
	wmDestroy   = 0x0002
	wmClose     = 0x0010
	wmCommand   = 0x0111
	wmPaint     = 0x000f
	wmTrayEvent = wmTray

	wmLButtonUp = 0x0202
	wmRButtonUp = 0x0205

	wsOverlapped    = 0x00000000
	wsCaption       = 0x00c00000
	wsSysMenu       = 0x00080000
	wsBorder        = 0x00800000
	wsPopup         = 0x80000000
	wsChild         = 0x40000000
	wsVisible       = 0x10000000
	wsTabStop       = 0x00010000
	wsExTool        = 0x00000080
	wsExTopmost     = 0x00000008
	bsPush          = 0x00000000
	bsDefPush       = 0x00000001
	esLeft          = 0x0000
	esPassword      = 0x0020
	cbsDropDownList = 0x0003

	swHide       = 0
	swShow       = 5
	swShowNormal = 1

	htCaption = 2
	tpmReturn = 0x0100

	cbResetContent = 0x014b
	cbAddString    = 0x0143
	cbSetCurSel    = 0x014e
	cbGetCurSel    = 0x0147
)

const (
	idPlayPrevious = 1001
	idPlayToggle   = 1002
	idPlayNext     = 1003
	idPlayerClose  = 1004
	idPlayerSetup  = 1005

	idServer     = 2001
	idCredential = 2002
	idProfiles   = 2003
	idLoad       = 2004
	idConnect    = 2005
	idCancel     = 2006
)

type point struct{ X, Y int32 }
type rect struct{ Left, Top, Right, Bottom int32 }

type msg struct {
	Window   uintptr
	Message  uint32
	WParam   uintptr
	LParam   uintptr
	Time     uint32
	Position point
}

type wndClassEx struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   uintptr
	Icon       uintptr
	Cursor     uintptr
	Background uintptr
	MenuName   uintptr
	ClassName  uintptr
	SmallIcon  uintptr
}

type notifyIconData struct {
	Size        uint32
	Window      uintptr
	ID          uint32
	Flags       uint32
	Callback    uint32
	Icon        uintptr
	Tip         [128]uint16
	State       uint32
	StateMask   uint32
	Info        [256]uint16
	Version     uint32
	InfoTitle   [64]uint16
	InfoFlags   uint32
	GUID        [16]byte
	BalloonIcon uintptr
}

type trayApp struct {
	mainWindow uintptr
	popup      uintptr
	mode       string

	serverEdit     uintptr
	credentialEdit uintptr
	profileCombo   uintptr
	statusLabel    uintptr
	titleLabel     uintptr
	artistLabel    uintptr
	progressLabel  uintptr
	toggleButton   uintptr

	profiles   []profile
	config     savedConfig
	configPath string
	token      string
	client     *apiClient

	mu       sync.RWMutex
	snapshot snapshot
	lastErr  string
}

var (
	app       *trayApp
	className = "PodwaffleWindowsTray"

	user32  = syscall.NewLazyDLL("user32.dll")
	shell32 = syscall.NewLazyDLL("shell32.dll")
	kernel  = syscall.NewLazyDLL("kernel32.dll")

	registerClass       = user32.NewProc("RegisterClassExW")
	createWindow        = user32.NewProc("CreateWindowExW")
	destroyWindow       = user32.NewProc("DestroyWindow")
	defWindowProc       = user32.NewProc("DefWindowProcW")
	showWindow          = user32.NewProc("ShowWindow")
	updateWindow        = user32.NewProc("UpdateWindow")
	setWindowPos        = user32.NewProc("SetWindowPos")
	setWindowText       = user32.NewProc("SetWindowTextW")
	getWindowTextLength = user32.NewProc("GetWindowTextLengthW")
	getWindowText       = user32.NewProc("GetWindowTextW")
	sendMessage         = user32.NewProc("SendMessageW")
	postMessage         = user32.NewProc("PostMessageW")
	getMessage          = user32.NewProc("GetMessageW")
	translateMessage    = user32.NewProc("TranslateMessage")
	dispatchMessage     = user32.NewProc("DispatchMessageW")
	loadIcon            = user32.NewProc("LoadIconW")
	createPopupMenu     = user32.NewProc("CreatePopupMenu")
	appendMenu          = user32.NewProc("AppendMenuW")
	trackPopupMenu      = user32.NewProc("TrackPopupMenu")
	destroyMenu         = user32.NewProc("DestroyMenu")
	setForeground       = user32.NewProc("SetForegroundWindow")
	getCursorPos        = user32.NewProc("GetCursorPos")
	getClientRect       = user32.NewProc("GetClientRect")
	beginPaint          = user32.NewProc("BeginPaint")
	endPaint            = user32.NewProc("EndPaint")
	shellNotify         = shell32.NewProc("Shell_NotifyIconW")
	getModuleHandle     = kernel.NewProc("GetModuleHandleW")
	windowCallback      = syscall.NewCallback(windowProc)
)

func main() {
	loaded, path, token, err := loadConfig()
	if err != nil {
		loaded = savedConfig{}
		token = ""
	}
	app = &trayApp{
		config:     loaded,
		configPath: path,
		token:      token,
	}
	if app.config.ServerURL != "" && app.token != "" {
		app.client = newAPIClient(app.config.ServerURL, app.token)
	}

	instance, _, _ := getModuleHandle.Call(0)
	class := syscall.StringToUTF16Ptr(className)
	icon, _, _ := loadIcon.Call(0, 32512)
	registered, _, err := registerClass.Call(uintptr(unsafe.Pointer(&wndClassEx{
		Size:      uint32(unsafe.Sizeof(wndClassEx{})),
		WndProc:   windowCallback,
		Instance:  instance,
		Icon:      icon,
		SmallIcon: icon,
		ClassName: uintptr(unsafe.Pointer(class)),
	})))
	if registered == 0 && err != nil {
		panic(fmt.Sprintf("could not register Windows window class: %v", err))
	}
	app.mainWindow = createNativeWindow(instance, "Podwaffle", wsOverlapped, 0, 0, 0, 0, 0, 0)
	if app.mainWindow == 0 {
		panic("could not create Podwaffle tray host window")
	}
	addTrayIcon(app.mainWindow, icon)
	showWindow.Call(app.mainWindow, swHide)

	go refreshLoop()
	if app.client != nil {
		go app.refreshSnapshot()
	} else {
		postMessage.Call(app.mainWindow, wmOperation, 0, 0)
	}

	var message msg
	for {
		result, _, _ := getMessage.Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0)
		if int32(result) <= 0 {
			break
		}
		translateMessage.Call(uintptr(unsafe.Pointer(&message)))
		dispatchMessage.Call(uintptr(unsafe.Pointer(&message)))
	}
}

func createNativeWindow(instance uintptr, title string, style, exStyle uint32, x, y, width, height int32, parent uintptr) uintptr {
	class := syscall.StringToUTF16Ptr(className)
	caption := syscall.StringToUTF16Ptr(title)
	hwnd, _, _ := createWindow.Call(
		uintptr(exStyle), uintptr(unsafe.Pointer(class)), uintptr(unsafe.Pointer(caption)),
		uintptr(style), uintptr(x), uintptr(y), uintptr(width), uintptr(height),
		parent, 0, instance, 0,
	)
	return hwnd
}

func addTrayIcon(hwnd, icon uintptr) {
	data := notifyIconData{
		Size:     uint32(unsafe.Sizeof(notifyIconData{})),
		Window:   hwnd,
		ID:       1,
		Flags:    0x0001 | 0x0002 | 0x0004,
		Callback: wmTrayEvent,
		Icon:     icon,
	}
	copy(data.Tip[:], syscall.StringToUTF16("Podwaffle"))
	shellNotify.Call(0, uintptr(unsafe.Pointer(&data)))
}

func removeTrayIcon(hwnd uintptr) {
	data := notifyIconData{Size: uint32(unsafe.Sizeof(notifyIconData{})), Window: hwnd, ID: 1}
	shellNotify.Call(2, uintptr(unsafe.Pointer(&data)))
}

func windowProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	if app == nil {
		return defWindowProcResult(hwnd, message, wParam, lParam)
	}
	switch message {
	case wmCreate:
		if app.mode == "player" {
			createPlayerControls(hwnd)
		} else if app.mode == "settings" {
			createSettingsControls(hwnd)
		}
	case wmTray:
		switch uint32(lParam) {
		case wmLButtonUp:
			app.showPlayer()
		case wmRButtonUp:
			showTrayMenu(hwnd)
		}
	case wmCommand:
		app.handleCommand(hwnd, int(wParam&0xffff), uint32((wParam>>16)&0xffff))
	case wmRefresh:
		app.updatePlayerControls()
	case wmOperation:
		app.showSettings()
	case wmClose:
		if hwnd != app.mainWindow {
			destroyWindow.Call(hwnd)
		} else {
			removeTrayIcon(hwnd)
			destroyWindow.Call(hwnd)
		}
	case wmDestroy:
		if hwnd == app.mainWindow {
			postMessage.Call(0, 0x0012, 0, 0)
		} else if hwnd == app.popup {
			app.popup = 0
			app.clearControls()
		}
	case wmPaint:
		paintWindow(hwnd)
	}
	return defWindowProcResult(hwnd, message, wParam, lParam)
}

func defWindowProcResult(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	result, _, _ := defWindowProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func (a *trayApp) showPlayer() {
	if a.client == nil || a.token == "" {
		a.showSettings()
		return
	}
	a.showPopup("player", "Podwaffle player", 390, 230)
	a.updatePlayerControls()
	go a.refreshSnapshot()
}

func (a *trayApp) showSettings() {
	a.showPopup("settings", "Podwaffle setup", 460, 300)
	if a.profiles == nil && a.config.ServerURL != "" {
		go a.loadProfiles(readText(a.serverEdit))
	}
}

func (a *trayApp) showPopup(mode, title string, width, height int32) {
	if a.popup != 0 {
		destroyWindow.Call(a.popup)
	}
	a.mode = mode
	instance, _, _ := getModuleHandle.Call(0)
	a.popup = createNativeWindow(instance, title, wsPopup|wsCaption|wsSysMenu|wsBorder, wsExTool|wsExTopmost, 0, 0, width, height, 0)
	if a.popup == 0 {
		return
	}
	var cursor point
	getCursorPos.Call(uintptr(unsafe.Pointer(&cursor)))
	setWindowPos.Call(a.popup, ^uintptr(0), uintptr(cursor.X-int32(width/2)), uintptr(cursor.Y-height-8), uintptr(width), uintptr(height), 0x0010)
	showWindow.Call(a.popup, swShowNormal)
	updateWindow.Call(a.popup)
}

func createControl(class, text string, style uint32, x, y, width, height int32, parent uintptr, controlID int) uintptr {
	instance, _, _ := getModuleHandle.Call(0)
	className := syscall.StringToUTF16Ptr(class)
	caption := syscall.StringToUTF16Ptr(text)
	hwnd, _, _ := createWindow.Call(0, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(caption)), uintptr(style), uintptr(x), uintptr(y), uintptr(width), uintptr(height), parent, uintptr(controlID), instance, 0)
	return hwnd
}

func createPlayerControls(hwnd uintptr) {
	app.statusLabel = createControl("STATIC", "", wsChild|wsVisible, 18, 16, 350, 20, hwnd, 0)
	app.titleLabel = createControl("STATIC", "Nothing playing", wsChild|wsVisible, 18, 48, 350, 28, hwnd, 0)
	app.artistLabel = createControl("STATIC", "", wsChild|wsVisible, 18, 76, 350, 22, hwnd, 0)
	app.progressLabel = createControl("STATIC", "", wsChild|wsVisible, 18, 106, 350, 22, hwnd, 0)
	createControl("BUTTON", "<< 15s", wsChild|wsVisible|wsTabStop|bsPush, 18, 146, 100, 32, hwnd, idPlayPrevious)
	app.toggleButton = createControl("BUTTON", "Play", wsChild|wsVisible|wsTabStop|bsDefPush, 132, 146, 110, 32, hwnd, idPlayToggle)
	createControl("BUTTON", "30s >>", wsChild|wsVisible|wsTabStop|bsPush, 256, 146, 100, 32, hwnd, idPlayNext)
	createControl("BUTTON", "Setup", wsChild|wsVisible|wsTabStop|bsPush, 18, 188, 100, 28, hwnd, idPlayerSetup)
	createControl("BUTTON", "Close", wsChild|wsVisible|wsTabStop|bsPush, 256, 188, 100, 28, hwnd, idPlayerClose)
}

func createSettingsControls(hwnd uintptr) {
	createControl("STATIC", "Server URL", wsChild|wsVisible, 20, 18, 120, 20, hwnd, 0)
	app.serverEdit = createControl("EDIT", app.config.ServerURL, wsChild|wsVisible|wsBorder|wsTabStop|esLeft, 20, 40, 410, 24, hwnd, idServer)
	createControl("STATIC", "API key / join code", wsChild|wsVisible, 20, 75, 180, 20, hwnd, 0)
	app.credentialEdit = createControl("EDIT", "", wsChild|wsVisible|wsBorder|wsTabStop|esLeft|esPassword, 20, 97, 410, 24, hwnd, idCredential)
	createControl("STATIC", "Profile", wsChild|wsVisible, 20, 132, 120, 20, hwnd, 0)
	app.profileCombo = createControl("COMBOBOX", "", wsChild|wsVisible|wsBorder|wsTabStop|cbsDropDownList, 20, 154, 410, 180, hwnd, idProfiles)
	app.statusLabel = createControl("STATIC", "Use Load profiles, then Connect.", wsChild|wsVisible, 20, 194, 410, 38, hwnd, 0)
	createControl("BUTTON", "Load profiles", wsChild|wsVisible|wsTabStop|bsPush, 20, 245, 125, 30, hwnd, idLoad)
	createControl("BUTTON", "Connect", wsChild|wsVisible|wsTabStop|bsDefPush, 160, 245, 110, 30, hwnd, idConnect)
	createControl("BUTTON", "Cancel", wsChild|wsVisible|wsTabStop|bsPush, 290, 245, 110, 30, hwnd, idCancel)
	populateProfiles()
}

func (a *trayApp) clearControls() {
	a.serverEdit, a.credentialEdit, a.profileCombo = 0, 0, 0
	a.statusLabel, a.titleLabel, a.artistLabel, a.progressLabel, a.toggleButton = 0, 0, 0, 0, 0
}

func populateProfiles() {
	if app.profileCombo == 0 {
		return
	}
	sendMessage.Call(app.profileCombo, cbResetContent, 0, 0)
	selected := 0
	for index, item := range app.profiles {
		caption := syscall.StringToUTF16Ptr(item.DisplayName)
		sendMessage.Call(app.profileCombo, cbAddString, 0, uintptr(unsafe.Pointer(caption)))
		if item.ID == app.config.ProfileID {
			selected = index
		}
	}
	if len(app.profiles) > 0 {
		sendMessage.Call(app.profileCombo, cbSetCurSel, uintptr(selected), 0)
	}
}

func (a *trayApp) handleCommand(hwnd uintptr, commandID int, notification uint32) {
	if notification != 0 && commandID != idProfiles {
		return
	}
	switch commandID {
	case idPlayPrevious:
		a.sendCommand("skip-backward", map[string]any{"offsetMs": a.skipMilliseconds(false)})
	case idPlayToggle:
		a.mu.RLock()
		state := a.snapshot.Playback.State
		a.mu.RUnlock()
		if state == "playing" {
			a.sendCommand("pause", nil)
		} else {
			a.sendCommand("play", nil)
		}
	case idPlayNext:
		a.sendCommand("skip-forward", map[string]any{"offsetMs": a.skipMilliseconds(true)})
	case idPlayerSetup:
		a.showSettings()
	case idPlayerClose, idCancel:
		destroyWindow.Call(hwnd)
	case idLoad:
		go a.loadProfiles(readText(a.serverEdit))
	case idConnect:
		a.connect(readText(a.serverEdit), readText(a.credentialEdit), selectedProfile())
	case idProfiles:
		// The selected profile is read when Connect is pressed.
	}
}

func (a *trayApp) skipMilliseconds(forward bool) int {
	a.mu.RLock()
	seconds := a.snapshot.Profile.Settings.Playback.SkipBackwardSeconds
	if forward {
		seconds = a.snapshot.Profile.Settings.Playback.SkipForwardSeconds
	}
	a.mu.RUnlock()
	if seconds < 1 || seconds > 120 {
		if forward {
			seconds = 30
		} else {
			seconds = 15
		}
	}
	return int(seconds * 1000)
}

func selectedProfile() profile {
	if app.profileCombo == 0 || len(app.profiles) == 0 {
		return profile{}
	}
	selection, _, _ := sendMessage.Call(app.profileCombo, cbGetCurSel, 0, 0)
	if int(selection) >= 0 && int(selection) < len(app.profiles) {
		return app.profiles[selection]
	}
	return profile{}
}

func readText(hwnd uintptr) string {
	if hwnd == 0 {
		return ""
	}
	length, _, _ := getWindowTextLength.Call(hwnd)
	buffer := make([]uint16, int(length)+1)
	getWindowText.Call(hwnd, uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)))
	return syscall.UTF16ToString(buffer)
}

func (a *trayApp) loadProfiles(serverURL string) {
	serverURL = strings.TrimSpace(serverURL)
	if _, err := url.ParseRequestURI(serverURL); err != nil || !strings.Contains(serverURL, "://") {
		a.setError("Enter a complete server URL, for example http://192.168.1.20:3000")
		return
	}
	setStatus("Loading profiles...")
	profiles, err := newAPIClient(serverURL, "").listProfiles()
	if err != nil {
		a.setError(err.Error())
		return
	}
	a.profiles = profiles
	postMessage.Call(a.popup, wmRefresh, 0, 0)
	setStatus(fmt.Sprintf("Found %d profile(s). Select one and connect.", len(profiles)))
}

func (a *trayApp) connect(serverURL, credential string, chosen profile) {
	serverURL = strings.TrimRight(strings.TrimSpace(serverURL), "/")
	if serverURL == "" || !strings.Contains(serverURL, "://") {
		setStatus("Enter a complete server URL first.")
		return
	}
	setStatus("Connecting...")
	go func() {
		client := newAPIClient(serverURL, strings.TrimSpace(credential))
		profiles, err := client.listProfiles()
		if err != nil {
			a.setError(err.Error())
			return
		}
		if len(profiles) == 0 {
			a.setError("This server has no enabled profiles.")
			return
		}
		if chosen.ID == "" {
			chosen = profiles[0]
		}
		token := strings.TrimSpace(credential)
		if token == "" {
			a.mu.RLock()
			if serverURL == a.config.ServerURL {
				token = a.token
			}
			a.mu.RUnlock()
		}
		client.token = token
		_, snapshotErr := client.getSnapshot()
		if snapshotErr != nil {
			if token == "" {
				a.setError("Enter an API key / join code.")
				return
			}
			token, err = newAPIClient(serverURL, "").join(chosen.ID, token)
			if err != nil {
				a.setError(err.Error())
				return
			}
			client.token = token
		}
		current, err := client.getSnapshot()
		if err != nil {
			a.setError(err.Error())
			return
		}
		if current.Profile.ID != "" {
			for _, item := range profiles {
				if item.ID == current.Profile.ID {
					chosen = item
					break
				}
			}
		}
		a.mu.Lock()
		a.client = client
		a.token = token
		a.config.ServerURL = serverURL
		a.config.ProfileID = chosen.ID
		a.config.ProfileName = chosen.DisplayName
		a.snapshot = current
		a.lastErr = ""
		a.mu.Unlock()
		if err := saveConfig(a.configPath, a.config, token); err != nil {
			a.setError(fmt.Sprintf("Connected, but could not save settings: %v", err))
			return
		}
		postMessage.Call(a.popup, wmRefresh, 0, 0)
		time.Sleep(300 * time.Millisecond)
		a.showPlayer()
	}()
}

func (a *trayApp) refreshSnapshot() {
	a.mu.RLock()
	client := a.client
	a.mu.RUnlock()
	if client == nil {
		return
	}
	current, err := client.getSnapshot()
	if err != nil {
		a.setError(err.Error())
		return
	}
	a.mu.Lock()
	a.snapshot = current
	a.lastErr = ""
	a.mu.Unlock()
	if a.popup != 0 {
		postMessage.Call(a.popup, wmRefresh, 0, 0)
	}
}

func refreshLoop() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		if app != nil {
			go app.refreshSnapshot()
		}
	}
}

func (a *trayApp) sendCommand(action string, parameters map[string]any) {
	a.mu.RLock()
	client := a.client
	a.mu.RUnlock()
	if client == nil {
		return
	}
	setStatus("Sending command...")
	go func() {
		if err := client.command(action, parameters); err != nil {
			a.setError(err.Error())
			return
		}
		a.refreshSnapshot()
	}()
}

func (a *trayApp) setError(message string) {
	a.mu.Lock()
	a.lastErr = message
	a.mu.Unlock()
	if a.popup != 0 {
		postMessage.Call(a.popup, wmRefresh, 0, 0)
	}
}

func setStatus(message string) {
	if app != nil {
		app.mu.Lock()
		app.lastErr = message
		app.mu.Unlock()
		if app.popup != 0 {
			postMessage.Call(app.popup, wmRefresh, 0, 0)
		}
	}
}

func setText(hwnd uintptr, value string) {
	if hwnd == 0 {
		return
	}
	caption := syscall.StringToUTF16Ptr(value)
	setWindowText.Call(hwnd, uintptr(unsafe.Pointer(caption)))
}

func (a *trayApp) updatePlayerControls() {
	if a.mode == "settings" {
		populateProfiles()
		a.mu.RLock()
		status := a.lastErr
		a.mu.RUnlock()
		if status != "" {
			setText(a.statusLabel, status)
		}
		return
	}
	if a.mode != "player" || a.popup == 0 {
		return
	}
	a.mu.RLock()
	current := a.snapshot
	status := a.lastErr
	profileName := a.config.ProfileName
	a.mu.RUnlock()
	if status != "" {
		setText(a.statusLabel, status)
	} else if profileName != "" {
		setText(a.statusLabel, profileName)
	}
	if current.Playback.Episode == nil {
		setText(a.titleLabel, "Nothing playing")
		setText(a.artistLabel, "")
		setText(a.progressLabel, "No active player")
		setText(a.toggleButton, "Play")
		return
	}
	setText(a.titleLabel, current.Playback.Episode.Title)
	setText(a.artistLabel, current.Playback.Episode.PodcastTitle)
	position := time.Duration(current.Playback.PositionMs) * time.Millisecond
	duration := time.Duration(current.Playback.DurationMs) * time.Millisecond
	setText(a.progressLabel, fmt.Sprintf("%s / %s", formatDuration(position), formatDuration(duration)))
	if current.Playback.State == "playing" {
		setText(a.toggleButton, "Pause")
	} else {
		setText(a.toggleButton, "Play")
	}
}

func formatDuration(value time.Duration) string {
	seconds := int(value / time.Second)
	if seconds < 0 {
		seconds = 0
	}
	return fmt.Sprintf("%d:%02d", seconds/60, seconds%60)
}

func showTrayMenu(hwnd uintptr) {
	menu, _, _ := createPopupMenu.Call()
	if menu == 0 {
		return
	}
	defer destroyMenu.Call(menu)
	addMenuItem(menu, 1, "Open player")
	addMenuItem(menu, 2, "Configure")
	addMenuItem(menu, 3, "Exit")
	var cursor point
	getCursorPos.Call(uintptr(unsafe.Pointer(&cursor)))
	setForeground.Call(hwnd)
	command, _, _ := trackPopupMenu.Call(menu, tpmReturn, uintptr(cursor.X), uintptr(cursor.Y), 0, hwnd, 0)
	switch command {
	case 1:
		app.showPlayer()
	case 2:
		app.showSettings()
	case 3:
		postMessage.Call(hwnd, wmClose, 0, 0)
	}
}

func addMenuItem(menu uintptr, id uintptr, caption string) {
	textValue := syscall.StringToUTF16Ptr(caption)
	appendMenu.Call(menu, 0x0000, id, uintptr(unsafe.Pointer(textValue)))
}

func paintWindow(hwnd uintptr) {
	// Begin/end paint keeps the native window valid while the child controls do
	// the actual rendering. This also avoids an unpainted white flash on popup.
	var paint [64]byte
	beginPaint.Call(hwnd, uintptr(unsafe.Pointer(&paint[0])))
	endPaint.Call(hwnd, uintptr(unsafe.Pointer(&paint[0])))
}
