package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// An app started from Finder, the Start menu or a desktop launcher gets a minimal PATH, which
// usually doesn't include Docker. Add the places Docker Desktop and the usual package managers put it.
func init() {
	home, _ := os.UserHomeDir()
	var extra []string
	switch runtime.GOOS {
	case "darwin":
		extra = []string{"/usr/local/bin", "/opt/homebrew/bin", "/Applications/Docker.app/Contents/Resources/bin",
			filepath.Join(home, ".docker", "bin"), filepath.Join(home, ".orbstack", "bin"), filepath.Join(home, ".rd", "bin")}
	case "windows":
		pf := os.Getenv("ProgramFiles")
		if pf == "" {
			pf = `C:\Program Files`
		}
		extra = []string{filepath.Join(pf, "Docker", "Docker", "resources", "bin")}
	default:
		extra = []string{"/usr/local/bin", "/usr/bin", "/snap/bin"}
	}
	path := os.Getenv("PATH")
	for _, p := range extra {
		if !strings.Contains(string(os.PathListSeparator)+path+string(os.PathListSeparator), string(os.PathListSeparator)+p+string(os.PathListSeparator)) {
			path += string(os.PathListSeparator) + p
		}
	}
	_ = os.Setenv("PATH", path)
}

// DockerStatus is what the installer needs from Docker before it can do anything.
type DockerStatus struct {
	Installed      bool   `json:"installed"`
	Running        bool   `json:"running"`
	Compose        bool   `json:"compose"`
	Version        string `json:"version"`
	Problem        string `json:"problem,omitempty"`
	InstallURL     string `json:"installUrl"`
	InstallCommand string `json:"installCommand,omitempty"`
}

func command(ctx context.Context, dir string, name string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	hideWindow(cmd) // no console window flashing up on Windows
	return cmd
}

// CheckDocker reports whether Docker and Compose v2 are installed and the daemon answers.
func CheckDocker(ctx context.Context) DockerStatus {
	s := DockerStatus{InstallURL: "https://www.docker.com/products/docker-desktop/"}
	if runtime.GOOS == "linux" {
		s.InstallURL = "https://docs.docker.com/engine/install/"
		s.InstallCommand = "curl -fsSL https://get.docker.com | sh"
	}
	if _, err := exec.LookPath("docker"); err != nil {
		s.Problem = "Docker is not installed."
		return s
	}
	s.Installed = true
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if out, err := command(ctx, "", "docker", "compose", "version", "--short").Output(); err == nil {
		s.Compose = true
		_ = out
	} else {
		s.Problem = "Docker Compose v2 ('docker compose') is not available. Update Docker."
	}
	out, err := command(ctx, "", "docker", "version", "--format", "{{.Server.Version}}").CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		switch {
		case strings.Contains(msg, "permission denied"):
			s.Problem = "Docker is installed but this user can't use it. Add yourself to the docker group (sudo usermod -aG docker $USER), then log out and in."
		default:
			s.Problem = "Docker is installed but not running. Start Docker Desktop (or the Docker service) and try again."
		}
		return s
	}
	s.Running = true
	s.Version = strings.TrimSpace(string(out))
	return s
}

// Compose runs `docker compose <args>` in dir and copies its output, line by line, to log.
func Compose(ctx context.Context, dir string, log io.Writer, args ...string) error {
	return ComposeEnv(ctx, dir, log, nil, args...)
}

// ComposeEnv is Compose with extra environment variables (KEY=value), which beat .env.
func ComposeEnv(ctx context.Context, dir string, log io.Writer, env []string, args ...string) error {
	cmd := command(ctx, dir, "docker", append([]string{"compose"}, args...)...)
	if len(env) > 0 {
		cmd.Env = append(os.Environ(), env...)
	}
	pr, pw := io.Pipe()
	cmd.Stdout, cmd.Stderr = pw, pw
	if err := cmd.Start(); err != nil {
		return err
	}
	done := make(chan struct{})
	go func() {
		sc := bufio.NewScanner(pr)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			fmt.Fprintln(log, sc.Text())
		}
		close(done)
	}()
	err := cmd.Wait()
	pw.Close()
	<-done
	if err != nil {
		return fmt.Errorf("docker compose %s failed: %w", strings.Join(args, " "), err)
	}
	return nil
}

// Service is one container of the install, as `docker compose ps` sees it.
type Service struct {
	Name   string `json:"name"`
	State  string `json:"state"`  // running, exited, restarting, ...
	Health string `json:"health"` // healthy, unhealthy, starting, or empty
	Status string `json:"status"` // e.g. "Up 3 minutes (healthy)"
}

// ComposePS lists the install's containers.
func ComposePS(ctx context.Context, dir string) ([]Service, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	out, err := command(ctx, dir, "docker", "compose", "ps", "--all", "--format", "json").Output()
	if err != nil {
		return nil, err
	}
	type row struct {
		Service, State, Health, Status string
	}
	var rows []row
	trimmed := bytes.TrimSpace(out)
	if bytes.HasPrefix(trimmed, []byte("[")) { // older Compose: one JSON array
		_ = json.Unmarshal(trimmed, &rows)
	} else { // newer Compose: one object per line
		for _, l := range bytes.Split(trimmed, []byte("\n")) {
			var r row
			if json.Unmarshal(l, &r) == nil && r.Service != "" {
				rows = append(rows, r)
			}
		}
	}
	services := make([]Service, 0, len(rows))
	for _, r := range rows {
		services = append(services, Service{Name: r.Service, State: r.State, Health: r.Health, Status: r.Status})
	}
	return services, nil
}

// PortInUse reports whether something on this machine already answers on the port.
func PortInUse(port int) bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 500*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

// ProjectInUse reports whether this machine already has a Compose project named "webbites" (the
// name in docker-compose.yml): a container of it, or just its volumes. A new install then needs a name
// of its own, or it would share the other's containers and data. Same test as deploy/install.sh.
func ProjectInUse(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	for _, args := range [][]string{
		{"ps", "-a", "-q", "--filter", "label=com.docker.compose.project=webbites"},
		{"volume", "ls", "-q", "--filter", "name=^webbites_"},
	} {
		if out, err := command(ctx, "", "docker", args...).Output(); err == nil && len(bytes.TrimSpace(out)) > 0 {
			return true
		}
	}
	return false
}

// NewProjectName is the Compose project name of an install that finds "webbites" taken.
func NewProjectName() string { return "webbites-" + randHex(4) }

// PortsBusy says which of the ports WebBites publishes (http and https) something already answers on.
func PortsBusy(httpPort, httpsPort int) error {
	var busy []string
	if PortInUse(httpPort) {
		busy = append(busy, fmt.Sprintf("port %d (http)", httpPort))
	}
	if PortInUse(httpsPort) {
		busy = append(busy, fmt.Sprintf("port %d (https)", httpsPort))
	}
	if len(busy) == 0 {
		return nil
	}
	hint := "or choose another port"
	if httpPort != 80 && PortInUse(httpsPort) {
		hint = "or, if port 80 is free, use it (it pairs with 443 instead)"
	}
	return fmt.Errorf("%s is already in use on this computer, and WebBites needs it. Stop what uses it, %s",
		strings.Join(busy, " and "), hint)
}

// OpenBrowser opens a URL with the system's default browser.
func OpenBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	hideWindow(cmd)
	return cmd.Start()
}

// OpenFolder shows a folder in Finder / Explorer / the file manager.
func OpenFolder(path string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", path)
	case "windows":
		cmd = exec.Command("explorer", path)
	default:
		cmd = exec.Command("xdg-open", path)
	}
	hideWindow(cmd)
	return cmd.Start()
}
