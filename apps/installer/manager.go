package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Config is what the app remembers between runs.
type Config struct {
	Dir string `json:"dir"` // the install folder (docker-compose.yml + .env live here)
}

func configDir() string {
	d, err := os.UserConfigDir()
	if err != nil {
		d = os.TempDir()
	}
	return filepath.Join(d, "WebBites Server")
}

func defaultInstallDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "WebBites"
	}
	return filepath.Join(home, "WebBites")
}

func LoadConfig() Config {
	c := Config{}
	if data, err := os.ReadFile(filepath.Join(configDir(), "config.json")); err == nil {
		_ = json.Unmarshal(data, &c)
	}
	if c.Dir == "" {
		c.Dir = defaultInstallDir()
	}
	return c
}

func SaveConfig(c Config) error {
	if err := os.MkdirAll(configDir(), 0o700); err != nil {
		return err
	}
	data, _ := json.MarshalIndent(c, "", "  ")
	return os.WriteFile(filepath.Join(configDir(), "config.json"), data, 0o600)
}

// Job is one long-running action (install, update, ...), with its output.
type Job struct {
	Name    string    `json:"name"`
	Running bool      `json:"running"`
	Error   string    `json:"error,omitempty"`
	Lines   []string  `json:"lines"`
	Started time.Time `json:"started"`
	Ended   time.Time `json:"ended,omitempty"`
}

// Manager does the work for the menu-bar app, the setup page and the CLI alike.
type Manager struct {
	mu        sync.Mutex
	cfg       Config
	job       *Job
	subs      map[chan string]struct{}
	latest    string
	latestAt  time.Time
	latestErr string
}

func NewManager() *Manager {
	return &Manager{cfg: LoadConfig(), subs: map[chan string]struct{}{}}
}

func (m *Manager) Dir() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.cfg.Dir
}

// SetDir points the app at another install folder (to set up there, or to manage an existing one).
func (m *Manager) SetDir(dir string) error {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return errors.New("choose a folder")
	}
	if !oneLine(dir) {
		return errors.New("the folder must be a single line without control characters")
	}
	if strings.HasPrefix(dir, "~") {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, strings.TrimPrefix(dir, "~"))
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	m.mu.Lock()
	m.cfg.Dir = abs
	cfg := m.cfg
	m.mu.Unlock()
	return SaveConfig(cfg)
}

func (m *Manager) envPath() string { return filepath.Join(m.Dir(), ".env") }

// Installed reports whether the folder holds a WebBites install.
func (m *Manager) Installed() bool {
	_, err := os.Stat(m.envPath())
	_, err2 := os.Stat(filepath.Join(m.Dir(), "docker-compose.yml"))
	return err == nil && err2 == nil
}

// State is everything the setup page and the menu show.
type State struct {
	App         string       `json:"app"`
	Docker      DockerStatus `json:"docker"`
	Dir         string       `json:"dir"`
	Installed   bool         `json:"installed"`
	Version     string       `json:"version,omitempty"`
	Latest      string       `json:"latest,omitempty"`
	LatestError string       `json:"latestError,omitempty"`
	PublicURL   string       `json:"publicUrl,omitempty"`
	Services    []Service    `json:"services"`
	Running     bool         `json:"running"`
	Job         *Job         `json:"job,omitempty"`
	// For a new install on this computer: 80 when it is free, else the first free fallback.
	SuggestedPort int    `json:"suggestedPort,omitempty"`
	OS            string `json:"os"`
}

// FreePort is the port a localhost install should use: 80 if nothing answers there (nor on the HTTPS
// port that goes with it), else the first free one of a few usual alternatives.
func FreePort() int {
	for _, p := range []int{80, 8080, 8081, 8088, 8888, 3080} {
		if !PortInUse(p) && !PortInUse(HTTPSPort(p)) {
			return p
		}
	}
	return 8080
}

func (m *Manager) State(ctx context.Context) State {
	s := State{App: appVersion, Docker: CheckDocker(ctx), Dir: m.Dir(), Installed: m.Installed(), Services: []Service{}, OS: runtime.GOOS}
	if !s.Installed {
		s.SuggestedPort = FreePort()
	}
	if s.Installed {
		if env, err := ReadEnv(m.envPath()); err == nil {
			s.Version = env["WEBBITES_VERSION"]
			s.PublicURL = env["PUBLIC_URL"]
		}
		if s.Docker.Running {
			if svcs, err := ComposePS(ctx, s.Dir); err == nil {
				s.Services = svcs
				for _, sv := range svcs {
					// Caddy publishes the ports: without it nothing answers, whatever else is up.
					if sv.Name == "caddy" && sv.State == "running" {
						s.Running = true
					}
				}
			}
		}
	}
	s.Latest, s.LatestError = m.latestVersion(ctx)
	m.mu.Lock()
	if m.job != nil {
		j := *m.job
		j.Lines = append([]string(nil), m.job.Lines...)
		s.Job = &j
	}
	m.mu.Unlock()
	return s
}

// latestVersion is cached for half an hour: GitHub limits unauthenticated calls.
func (m *Manager) latestVersion(ctx context.Context) (string, string) {
	m.mu.Lock()
	if time.Since(m.latestAt) < 30*time.Minute && (m.latest != "" || m.latestErr != "") {
		defer m.mu.Unlock()
		return m.latest, m.latestErr
	}
	m.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	v, err := LatestVersion(ctx)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.latest, m.latestErr, m.latestAt = v, "", time.Now()
	if err != nil {
		m.latestErr = err.Error()
	}
	return m.latest, m.latestErr
}

// ---- jobs ---------------------------------------------------------------------------------------

// Subscribe receives every output line of every job from now on.
func (m *Manager) Subscribe() (chan string, func()) {
	ch := make(chan string, 256)
	m.mu.Lock()
	m.subs[ch] = struct{}{}
	m.mu.Unlock()
	return ch, func() {
		m.mu.Lock()
		delete(m.subs, ch)
		m.mu.Unlock()
	}
}

type jobWriter struct{ m *Manager }

func (w jobWriter) Write(p []byte) (int, error) {
	for _, line := range strings.Split(strings.TrimRight(string(p), "\n"), "\n") {
		w.m.emit(line)
	}
	return len(p), nil
}

func (m *Manager) emit(line string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.job != nil {
		m.job.Lines = append(m.job.Lines, line)
		if len(m.job.Lines) > 2000 {
			m.job.Lines = m.job.Lines[len(m.job.Lines)-2000:]
		}
	}
	for ch := range m.subs {
		select {
		case ch <- line:
		default: // a slow listener misses lines rather than blocking the job
		}
	}
}

func (m *Manager) currentJob() *Job {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.job
}

var errBusy = errors.New("something is already running; wait for it to finish")

// Run starts fn as the current job. With wait, it returns fn's error; otherwise it returns at once.
func (m *Manager) Run(name string, wait bool, fn func(ctx context.Context, log io.Writer) error) error {
	m.mu.Lock()
	if m.job != nil && m.job.Running {
		m.mu.Unlock()
		return errBusy
	}
	m.job = &Job{Name: name, Running: true, Started: time.Now(), Lines: []string{}}
	m.mu.Unlock()

	done := make(chan error, 1)
	go func() {
		err := fn(context.Background(), jobWriter{m})
		m.mu.Lock()
		m.job.Running = false
		m.job.Ended = time.Now()
		if err != nil {
			m.job.Error = err.Error()
		}
		m.mu.Unlock()
		if err != nil {
			m.emit("Error: " + err.Error())
		} else {
			m.emit("Done.")
		}
		m.emit("\x00end") // tells the setup page the job is over
		done <- err
	}()
	if wait {
		return <-done
	}
	return nil
}

// ---- actions ------------------------------------------------------------------------------------

// Install sets WebBites up in opts.Dir and starts it.
func (m *Manager) Install(opts Options, wait bool) error {
	if err := opts.Normalize(); err != nil {
		return err
	}
	if opts.Dir != "" {
		if err := m.SetDir(opts.Dir); err != nil {
			return err
		}
	}
	dir := m.Dir()
	if _, err := os.Stat(filepath.Join(dir, ".env")); err == nil {
		return fmt.Errorf("%s already holds a WebBites install (it has a .env); manage it, or choose an empty folder", dir)
	}
	if st := CheckDocker(context.Background()); !st.Running || !st.Compose {
		return errors.New(st.Problem)
	}
	if err := PortsBusy(opts.HTTPPort, HTTPSPort(opts.HTTPPort)); err != nil {
		return err
	}
	if ProjectInUse(context.Background()) {
		opts.Project = NewProjectName()
	}
	return m.Run("Installing WebBites", wait, func(ctx context.Context, log io.Writer) error {
		if opts.Version == "latest" {
			v, err := LatestVersion(ctx)
			if err != nil {
				return err
			}
			opts.Version = v
		}
		if err := DownloadDeployFiles(ctx, dir, opts.Version, log); err != nil {
			return err
		}
		if opts.Project != "" {
			fmt.Fprintf(log, "Another WebBites is already set up on this computer, so this one is named %s and keeps its own data.\n", opts.Project)
		}
		fmt.Fprintln(log, "Writing .env with new secrets...")
		if err := os.WriteFile(filepath.Join(dir, ".env"), []byte(GenerateEnv(opts, time.Now())), 0o600); err != nil {
			return err
		}
		fmt.Fprintln(log, "Downloading the images (the first time takes a few minutes)...")
		if err := Compose(ctx, dir, log, "pull", "--quiet"); err != nil {
			// Nothing has been created yet, so the new .env holds no data's keys: remove it, so the
			// install can simply be tried again (with other answers, if need be).
			_ = os.Remove(filepath.Join(dir, ".env"))
			fmt.Fprintln(log, "Nothing was started. Check your connection and try again.")
			return err
		}
		if err := startStack(ctx, dir, log, false); err != nil {
			// The database may already be initialised with the keys in .env: keep it.
			fmt.Fprintln(log, "Some services did not start. Look at the logs, then use Start to try again.")
			return err
		}
		url, _, _ := opts.Addresses()
		fmt.Fprintf(log, "WebBites %s is running at %s\n", opts.Version, url)
		fmt.Fprintln(log, "Open it and create your account: the first account becomes the administrator.")
		fmt.Fprintf(log, "Back up %s: without it your data can't be decrypted or restored.\n", filepath.Join(dir, ".env"))
		if opts.Domain != "localhost" {
			fmt.Fprintf(log, "Make sure %s points at this machine and ports 80 and 443 are open; Caddy then gets the HTTPS certificate by itself.\n", opts.Domain)
		}
		return nil
	})
}

func startStack(ctx context.Context, dir string, log io.Writer, pull bool) error {
	if pull {
		fmt.Fprintln(log, "Downloading the images (the first time takes a few minutes)...")
		if err := Compose(ctx, dir, log, "pull", "--quiet"); err != nil {
			return err
		}
	}
	fmt.Fprintln(log, "Starting WebBites...")
	return Compose(ctx, dir, log, "up", "-d", "--remove-orphans")
}

func (m *Manager) requireInstall() (string, error) {
	if !m.Installed() {
		return "", fmt.Errorf("no WebBites install in %s", m.Dir())
	}
	return m.Dir(), nil
}

func (m *Manager) Start(wait bool) error {
	dir, err := m.requireInstall()
	if err != nil {
		return err
	}
	if err := portsFree(dir); err != nil {
		return err
	}
	return m.Run("Starting WebBites", wait, func(ctx context.Context, log io.Writer) error {
		return startStack(ctx, dir, log, false)
	})
}

// portsFree refuses to start a stopped install whose ports something else has taken. When Caddy
// is already up the ports are its own, and starting is a no-op.
func portsFree(dir string) error {
	if svcs, err := ComposePS(context.Background(), dir); err == nil {
		for _, sv := range svcs {
			if sv.Name == "caddy" && sv.State == "running" {
				return nil
			}
		}
	}
	env, _ := ReadEnv(filepath.Join(dir, ".env"))
	httpPort, _ := strconv.Atoi(env["HTTP_PORT"])
	httpsPort, _ := strconv.Atoi(env["HTTPS_PORT"])
	if httpPort == 0 {
		httpPort = 80
	}
	if httpsPort == 0 {
		httpsPort = 443
	}
	return PortsBusy(httpPort, httpsPort)
}

func (m *Manager) Stop(wait bool) error {
	dir, err := m.requireInstall()
	if err != nil {
		return err
	}
	return m.Run("Stopping WebBites", wait, func(ctx context.Context, log io.Writer) error {
		return Compose(ctx, dir, log, "stop")
	})
}

func (m *Manager) Restart(wait bool) error {
	dir, err := m.requireInstall()
	if err != nil {
		return err
	}
	return m.Run("Restarting WebBites", wait, func(ctx context.Context, log io.Writer) error {
		return Compose(ctx, dir, log, "restart")
	})
}

// Update moves the install to a release (the latest one when version is empty): new deployment
// files (the old ones kept in .previous), the version in .env, new images, restarted containers.
// The images are pulled first, and nothing in the folder changes until that has worked; if the
// restart then fails, the folder goes back to how it was.
func (m *Manager) Update(version string, wait bool) error {
	dir, err := m.requireInstall()
	if err != nil {
		return err
	}
	return m.Run("Updating WebBites", wait, func(ctx context.Context, log io.Writer) error {
		v := strings.TrimPrefix(strings.TrimSpace(version), "v")
		if v == "" || v == "latest" {
			latest, err := LatestVersion(ctx)
			if err != nil {
				return err
			}
			v = latest
		}
		if err := validVersion(v); err != nil {
			return err
		}
		envPath := filepath.Join(dir, ".env")
		oldEnv, err := os.ReadFile(envPath)
		if err != nil {
			return err
		}
		env, _ := ReadEnv(envPath)
		fmt.Fprintf(log, "Updating from %s to %s. Your .env and data are kept.\n", env["WEBBITES_VERSION"], v)
		files, err := FetchDeployFiles(ctx, v, log)
		if err != nil {
			return err
		}
		if err := pullRelease(ctx, dir, v, files, log); err != nil {
			fmt.Fprintln(log, "Nothing was changed: WebBites stays on its current version.")
			return err
		}
		oldFiles := readDeployFiles(dir)
		undo := func() {
			restoreDeployFiles(dir, oldFiles)
			_ = os.WriteFile(envPath, oldEnv, 0o600) // an existing file keeps its permissions
		}
		if err := WriteDeployFiles(dir, files); err != nil {
			undo()
			return err
		}
		if err := SetEnvValue(envPath, "WEBBITES_VERSION", v); err != nil {
			undo()
			return err
		}
		if err := startStack(ctx, dir, log, false); err != nil {
			fmt.Fprintf(log, "The update did not start. Going back to %s...\n", env["WEBBITES_VERSION"])
			undo()
			_ = startStack(ctx, dir, log, false) // best effort: bring the old version back up
			return err
		}
		fmt.Fprintf(log, "WebBites is now on %s. The previous deployment files are in %s.\n", v, filepath.Join(dir, ".previous"))
		return nil
	})
}

// pullRelease downloads a release's images without touching the install folder: the new compose
// file is used from a scratch folder, with the new version in place of the one in .env.
func pullRelease(ctx context.Context, dir, version string, files map[string][]byte, log io.Writer) error {
	tmp, err := os.MkdirTemp("", "webbites-update-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	for f, data := range files {
		if err := os.WriteFile(filepath.Join(tmp, f), data, 0o644); err != nil {
			return err
		}
	}
	fmt.Fprintln(log, "Downloading the images (the first time takes a few minutes)...")
	return ComposeEnv(ctx, dir, log, []string{"WEBBITES_VERSION=" + version},
		"-f", filepath.Join(tmp, "docker-compose.yml"), "--project-directory", dir, "pull", "--quiet")
}

// readDeployFiles returns the deployment files now in dir (a missing one is left out).
func readDeployFiles(dir string) map[string][]byte {
	out := map[string][]byte{}
	for _, f := range deployFiles {
		if data, err := os.ReadFile(filepath.Join(dir, f)); err == nil {
			out[f] = data
		}
	}
	return out
}

// restoreDeployFiles puts back what readDeployFiles returned, removing files that were not there.
func restoreDeployFiles(dir string, old map[string][]byte) {
	for _, f := range deployFiles {
		path := filepath.Join(dir, f)
		data, ok := old[f]
		if !ok {
			_ = os.Remove(path)
			continue
		}
		mode := os.FileMode(0o644)
		if f == "install.sh" {
			mode = 0o755
		}
		_ = os.WriteFile(path, data, mode)
	}
}

// Logs returns the last lines of a service's log (all services when service is empty).
func (m *Manager) Logs(ctx context.Context, service string, tail int) (string, error) {
	dir, err := m.requireInstall()
	if err != nil {
		return "", err
	}
	args := []string{"compose", "logs", "--no-color", "--tail", fmt.Sprint(tail)}
	if service != "" {
		args = append(args, service)
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	out, err := command(ctx, dir, "docker", args...).CombinedOutput()
	return string(out), err
}
