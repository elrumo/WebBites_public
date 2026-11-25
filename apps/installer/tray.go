package main

// The menu-bar (macOS) / notification-area (Windows, Linux) icon.

import (
	"context"
	_ "embed"
	"os"
	"runtime"
	"time"

	"fyne.io/systray"
)

//go:embed icons/tray.png
var trayPNG []byte

//go:embed icons/tray.ico
var trayICO []byte

//go:embed icons/tray-template.png
var trayTemplate []byte

// HasDesktop reports whether there is a desktop session to put an icon in.
func HasDesktop() bool {
	switch runtime.GOOS {
	case "darwin", "windows":
		return true
	default:
		return (os.Getenv("DISPLAY") != "" || os.Getenv("WAYLAND_DISPLAY") != "") && os.Getenv("DBUS_SESSION_BUS_ADDRESS") != ""
	}
}

// RunTray shows the icon and its menu until Quit. It must run on the main goroutine.
func RunTray(m *Manager, ui *UIServer) {
	systray.Run(func() { trayReady(m, ui) }, func() { ui.Close() })
}

func trayReady(m *Manager, ui *UIServer) {
	switch runtime.GOOS {
	case "darwin":
		systray.SetTemplateIcon(trayTemplate, trayPNG)
	case "windows":
		systray.SetIcon(trayICO)
	default:
		systray.SetIcon(trayPNG)
	}
	systray.SetTooltip("WebBites Server")

	status := systray.AddMenuItem("Checking…", "")
	status.Disable()
	open := systray.AddMenuItem("Open WebBites", "Open your WebBites in the browser")
	systray.AddSeparator()
	start := systray.AddMenuItem("Start", "")
	stop := systray.AddMenuItem("Stop", "")
	update := systray.AddMenuItem("Update…", "")
	update.Hide()
	systray.AddSeparator()
	manage := systray.AddMenuItem("Settings and logs…", "Open the WebBites Server page")
	folder := systray.AddMenuItem("Show folder", "")
	systray.AddSeparator()
	quit := systray.AddMenuItem("Quit WebBites Server", "WebBites itself keeps running in Docker")

	var publicURL string
	refresh := func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		s := m.State(ctx)
		publicURL = s.PublicURL
		busy := s.Job != nil && s.Job.Running
		switch {
		case !s.Docker.Running:
			status.SetTitle("Docker is not running")
		case !s.Installed:
			status.SetTitle("Not set up yet")
		case busy:
			status.SetTitle(s.Job.Name + "…")
		case s.Running:
			status.SetTitle("Running · " + s.Version)
		default:
			status.SetTitle("Stopped · " + s.Version)
		}
		ready := s.Docker.Running && s.Installed && !busy
		setEnabled(open, s.Installed && s.Running)
		setEnabled(start, ready && !s.Running)
		setEnabled(stop, ready && s.Running)
		setEnabled(folder, s.Installed)
		if ready && s.Latest != "" && s.Version != "" && s.Version != "latest" && semverNewer(s.Latest, s.Version) {
			update.SetTitle("Update to " + s.Latest + "…")
			update.Show()
		} else {
			update.Hide()
		}
	}

	go func() {
		refresh()
		// First launch: open the setup page straight away.
		if !m.Installed() {
			_ = OpenBrowser(ui.URL)
		}
		tick := time.NewTicker(10 * time.Second)
		for {
			select {
			case <-tick.C:
				refresh()
			case <-open.ClickedCh:
				if publicURL != "" {
					_ = OpenBrowser(publicURL)
				}
			case <-start.ClickedCh:
				_ = m.Start(false)
				refresh()
			case <-stop.ClickedCh:
				_ = m.Stop(false)
				refresh()
			case <-update.ClickedCh:
				_ = OpenBrowser(ui.URL) // the page asks for confirmation before updating
			case <-manage.ClickedCh:
				_ = OpenBrowser(ui.URL)
			case <-folder.ClickedCh:
				_ = OpenFolder(m.Dir())
			case <-quit.ClickedCh:
				systray.Quit()
				return
			}
		}
	}()
}

func setEnabled(item *systray.MenuItem, on bool) {
	if on {
		item.Enable()
	} else {
		item.Disable()
	}
}

// semverNewer reports whether version a (x.y.z) is newer than b.
func semverNewer(a, b string) bool {
	var pa, pb [3]int
	if n, _ := sscanVersion(a, &pa); n != 3 {
		return a != b
	}
	if n, _ := sscanVersion(b, &pb); n != 3 {
		return a != b
	}
	for i := 0; i < 3; i++ {
		if pa[i] != pb[i] {
			return pa[i] > pb[i]
		}
	}
	return false
}
