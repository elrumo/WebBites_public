package main

import (
	"context"
	"errors"
	"flag"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

// stubDockerScript is a `docker` for the manager's calls: it logs every call (with the version Compose
// would see) to $STUB_LOG, fails `pull` when STUB_FAIL=pull, fails the first `up` when STUB_FAIL=up,
// and lists the services in $STUB_PS (JSON lines) for `compose ps`.
const stubDockerScript = `#!/bin/sh
echo "$* [version=$WEBBITES_VERSION]" >> "$STUB_LOG"
case "$*" in
  "compose version"*) echo 2.30.0; exit 0 ;;
  "version "*) echo 27.0.0; exit 0 ;;
  "compose ps"*) printf '%s\n' "$STUB_PS"; exit 0 ;;
  "ps "*|"volume "*) [ -n "$STUB_TAKEN" ] && echo abc123; exit 0 ;;
  *" pull "*) [ "$STUB_FAIL" = pull ] && { echo "manifest unknown"; exit 1; }; exit 0 ;;
  *" up "*) if [ "$STUB_FAIL" = up ] && [ ! -f "$STUB_LOG.up" ]; then touch "$STUB_LOG.up"; echo "boom"; exit 1; fi; exit 0 ;;
esac
exit 0
`

// testManager is a Manager on a scratch install folder, with the stub docker first on PATH.
func testManager(t *testing.T, env string) (*Manager, string, string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the stub docker is a shell script")
	}
	bin := t.TempDir()
	if err := os.WriteFile(filepath.Join(bin, "docker"), []byte(stubDockerScript), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	log := filepath.Join(t.TempDir(), "docker.log")
	t.Setenv("STUB_LOG", log)
	t.Setenv("STUB_FAIL", "")
	t.Setenv("STUB_TAKEN", "")
	t.Setenv("STUB_PS", "")
	deploy, _ := filepath.Abs("../../deploy")
	t.Setenv("WEBBITES_SOURCE", "file://"+filepath.ToSlash(deploy))

	dir := t.TempDir()
	for _, f := range deployFiles {
		_ = os.WriteFile(filepath.Join(dir, f), []byte("old "+f), 0o644)
	}
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte(env), 0o600); err != nil {
		t.Fatal(err)
	}
	m := &Manager{cfg: Config{Dir: dir}, subs: map[chan string]struct{}{}, latest: "9.9.9", latestAt: time.Now()}
	return m, dir, log
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, _ := os.ReadFile(path)
	return string(data)
}

func TestUpdatePullsBeforeChangingAnything(t *testing.T) {
	m, dir, log := testManager(t, "WEBBITES_VERSION=0.7.0\nPUBLIC_URL=http://localhost\n")
	t.Setenv("STUB_FAIL", "pull")
	if err := m.Update("0.8.0", true); err == nil {
		t.Fatal("want the failed pull to fail the update")
	}
	if got := readFile(t, filepath.Join(dir, ".env")); got != "WEBBITES_VERSION=0.7.0\nPUBLIC_URL=http://localhost\n" {
		t.Errorf(".env changed: %q", got)
	}
	if got := readFile(t, filepath.Join(dir, "Caddyfile")); got != "old Caddyfile" {
		t.Errorf("Caddyfile changed: %q", got)
	}
	if _, err := os.Stat(filepath.Join(dir, ".previous")); err == nil {
		t.Errorf(".previous was created for an update that did not happen")
	}
	if l := readFile(t, log); strings.Contains(l, " up ") || !strings.Contains(l, "pull --quiet [version=0.8.0]") {
		t.Errorf("want a pull with the new version and no up, got:\n%s", l)
	}
}

func TestUpdateGoesBackWhenTheRestartFails(t *testing.T) {
	m, dir, log := testManager(t, "WEBBITES_VERSION=0.7.0\n")
	t.Setenv("STUB_FAIL", "up")
	if err := m.Update("0.8.0", true); err == nil {
		t.Fatal("want the failed up to fail the update")
	}
	if got := readFile(t, filepath.Join(dir, ".env")); got != "WEBBITES_VERSION=0.7.0\n" {
		t.Errorf(".env = %q, want the old version back", got)
	}
	for _, f := range deployFiles {
		if got := readFile(t, filepath.Join(dir, f)); got != "old "+f {
			t.Errorf("%s = %.30q, want the old file back", f, got)
		}
		if got := readFile(t, filepath.Join(dir, ".previous", f)); got != "old "+f {
			t.Errorf(".previous/%s = %.30q, want the old file", f, got)
		}
	}
	if n := strings.Count(readFile(t, log), " up "); n != 2 {
		t.Errorf("want the failed up and one up to bring the old version back, got %d", n)
	}
	if info, _ := os.Stat(filepath.Join(dir, ".env")); info.Mode().Perm() != 0o600 {
		t.Errorf(".env permissions are %v", info.Mode().Perm())
	}
}

func TestUpdateSucceeds(t *testing.T) {
	m, dir, _ := testManager(t, "WEBBITES_VERSION=0.7.0\n")
	if err := m.Update("v0.8.0", true); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, filepath.Join(dir, ".env")); got != "WEBBITES_VERSION=0.8.0\n" {
		t.Errorf(".env = %q", got)
	}
	if got := readFile(t, filepath.Join(dir, ".previous", "Caddyfile")); got != "old Caddyfile" {
		t.Errorf(".previous/Caddyfile = %.30q", got)
	}
	if got := readFile(t, filepath.Join(dir, "docker-compose.yml")); strings.HasPrefix(got, "old ") {
		t.Errorf("docker-compose.yml was not replaced")
	}
}

func TestUpdateRejectsAnUnsafeVersion(t *testing.T) {
	m, dir, _ := testManager(t, "WEBBITES_VERSION=0.7.0\n")
	for _, v := range []string{"1.2.3\nEVIL=1", "../../x", "1 2", "1.2.3;rm"} {
		if err := m.Update(v, true); err == nil {
			t.Errorf("version %q should be refused", v)
		}
	}
	if got := readFile(t, filepath.Join(dir, ".env")); got != "WEBBITES_VERSION=0.7.0\n" {
		t.Errorf(".env changed: %q", got)
	}
}

func TestSetDirRefusesControlCharacters(t *testing.T) {
	m := &Manager{cfg: Config{Dir: t.TempDir()}, subs: map[chan string]struct{}{}}
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	for _, d := range []string{"/tmp/a\nb", "/tmp/a\rb", "/tmp/a\x00b"} {
		if err := m.SetDir(d); err == nil {
			t.Errorf("%q should be refused", d)
		}
	}
	if err := m.SetDir(t.TempDir()); err != nil {
		t.Errorf("a plain folder: %v", err)
	}
}

// Running means Caddy is up: it is what publishes the ports.
func TestStatusRunsOnCaddy(t *testing.T) {
	m, _, _ := testManager(t, "WEBBITES_VERSION=0.7.0\nPUBLIC_URL=http://localhost\n")
	t.Setenv("STUB_PS", `{"Service":"web","State":"running"}`+"\n"+`{"Service":"caddy","State":"exited"}`)
	if m.State(context.Background()).Running {
		t.Errorf("web up but caddy down is not running")
	}
	t.Setenv("STUB_PS", `{"Service":"web","State":"exited"}`+"\n"+`{"Service":"caddy","State":"running"}`)
	if !m.State(context.Background()).Running {
		t.Errorf("caddy up is running")
	}
}

func TestProjectInUse(t *testing.T) {
	testManager(t, "")
	if ProjectInUse(context.Background()) {
		t.Errorf("a clean machine keeps the name webbites")
	}
	t.Setenv("STUB_TAKEN", "1")
	if !ProjectInUse(context.Background()) {
		t.Errorf("an existing webbites project must be noticed")
	}
}

func TestHTTPSPort(t *testing.T) {
	if HTTPSPort(80) != 443 || HTTPSPort(8080) != 8443 {
		t.Errorf("got %d and %d", HTTPSPort(80), HTTPSPort(8080))
	}
}

func busyListener(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Skip("cannot listen:", err)
	}
	t.Cleanup(func() { ln.Close() })
	return ln.Addr().(*net.TCPAddr).Port
}

func TestPortsBusyNamesThePort(t *testing.T) {
	busy := busyListener(t)
	if err := PortsBusy(busy, 1); err == nil || !strings.Contains(err.Error(), "port "+itoa(busy)+" (http)") {
		t.Errorf("busy http port: %v", err)
	}
	if err := PortsBusy(1, busy); err == nil || !strings.Contains(err.Error(), "port "+itoa(busy)+" (https)") {
		t.Errorf("busy https port: %v", err)
	}
	if err := PortsBusy(1, 2); err != nil {
		t.Errorf("free ports: %v", err)
	}
}

func itoa(n int) string { return strconv.Itoa(n) }

// A stopped install whose https port was taken in the meantime does not start.
func TestStartChecksBothPorts(t *testing.T) {
	busy := busyListener(t)
	m, _, log := testManager(t, "HTTP_PORT=1\nHTTPS_PORT="+itoa(busy)+"\n")
	err := m.Start(true)
	if err == nil || !strings.Contains(err.Error(), itoa(busy)+" (https)") {
		t.Fatalf("got %v", err)
	}
	if strings.Contains(readFile(t, log), " up ") {
		t.Errorf("docker compose up must not run")
	}
	// Caddy already running: the ports are its own, starting is allowed.
	t.Setenv("STUB_PS", `{"Service":"caddy","State":"running"}`)
	if err := m.Start(true); err != nil {
		t.Errorf("with caddy up: %v", err)
	}
}

func TestInfoFlagsAndHelp(t *testing.T) {
	for _, a := range []string{"-h", "--help", "-help", "--version"} {
		if !isInfoFlag(a) {
			t.Errorf("%s must be an info flag", a)
		}
	}
	for _, a := range []string{"--dir", "-f", "install", "--version=1"} {
		if isInfoFlag(a) {
			t.Errorf("%s is not an info flag", a)
		}
	}
	for _, c := range []string{"help", "-h", "--help", "version", "--version"} {
		if err := run(c, nil); err != nil {
			t.Errorf("run(%q) = %v, want nil (exit 0)", c, err)
		}
	}
	// "install --help" ends with flag.ErrHelp, which main treats as success.
	if err := run("install", []string{"--help"}); !errors.Is(err, flag.ErrHelp) {
		t.Errorf("install --help: %v", err)
	}
}

func TestGenerateEnvWritesProjectOnlyWhenSet(t *testing.T) {
	o := Options{}
	_ = o.Normalize()
	if strings.Contains(GenerateEnv(o, time.Now()), "COMPOSE_PROJECT_NAME") {
		t.Errorf("no project name unless one is taken")
	}
	o.Project = "webbites-0123abcd"
	if !strings.Contains(GenerateEnv(o, time.Now()), "\nCOMPOSE_PROJECT_NAME=webbites-0123abcd\n") {
		t.Errorf("project name missing")
	}
}
