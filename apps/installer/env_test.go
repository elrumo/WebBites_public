package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"
)

// These variables differ on every run (secrets) or by design (the comment on top), so only their
// presence and shape is compared.
var secretKeys = map[string]bool{
	"MONGO_PASSWORD": true, "PARSE_APP_ID": true, "PARSE_JS_KEY": true, "PARSE_MASTER_KEY": true, "CUSTOM_API_KEY": true,
	"AUDIO_TOKEN_SECRET": true, "SHARE_LINK_SECRET": true, "BACKUP_ENCRYPTION_KEY": true, "SETTINGS_ENCRYPTION_KEY": true,
	"MEILI_MASTER_KEY": true, "SCREENSHOT_API_KEY": true, "RUSTFS_ACCESS_KEY": true, "RUSTFS_SECRET_KEY": true,
	"S3_ACCESS_KEY": true, "S3_SECRET_KEY": true,
	"COMPOSE_PROJECT_NAME": true, // webbites-<8 random hex>, when the name "webbites" is taken
}

func parseEnv(t *testing.T, text string) map[string]string {
	t.Helper()
	f := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(f, []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
	env, err := ReadEnv(f)
	if err != nil {
		t.Fatal(err)
	}
	return env
}

// stubDocker answers install.sh's checks. With taken set it also finds a "webbites" project already
// on the machine (a container, for `docker ps`, and a volume, for `docker volume ls`).
const stubDocker = "#!/bin/sh\nexit 0\n"
const stubDockerTaken = "#!/bin/sh\ncase \"$1\" in ps|volume) echo abc123 ;; esac\nexit 0\n"

// installShRun runs deploy/install.sh in a scratch folder with a stand-in `docker`; it returns the
// folder and what the script printed (stdout and stderr together), with its exit error.
func installShRun(t *testing.T, dir, docker string, args ...string) (string, error) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("install.sh needs sh")
	}
	deploy, _ := filepath.Abs("../../deploy")
	for _, f := range []string{"install.sh", "docker-compose.yml", "Caddyfile", ".env.example"} {
		data, err := os.ReadFile(filepath.Join(deploy, f))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, f), data, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	bin := t.TempDir()
	if err := os.WriteFile(filepath.Join(bin, "docker"), []byte(docker), 0o755); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("sh", append([]string{filepath.Join(dir, "install.sh"), "--yes"}, args...)...)
	cmd.Env = append(os.Environ(), "PATH="+bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	cmd.Stdin = nil
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// runInstallSh runs install.sh and returns the .env it wrote.
func runInstallSh(t *testing.T, args ...string) map[string]string {
	return runInstallShDocker(t, stubDocker, args...)
}

func runInstallShDocker(t *testing.T, docker string, args ...string) map[string]string {
	t.Helper()
	dir := t.TempDir()
	if out, err := installShRun(t, dir, docker, args...); err != nil {
		t.Fatalf("install.sh: %v\n%s", err, out)
	}
	data, err := os.ReadFile(filepath.Join(dir, ".env"))
	if err != nil {
		t.Fatal(err)
	}
	return parseEnv(t, string(data))
}

func keys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// The Go installer and install.sh write the same .env for the same answers.
func TestEnvMatchesInstallSh(t *testing.T) {
	cases := []struct {
		name   string
		docker string // install.sh's stand-in docker
		sh     []string
		opts   Options
	}{
		{"defaults", stubDocker, nil, Options{Screenshots: true}},
		{"localhost port", stubDocker, []string{"--http-port", "8080", "--no-screenshots", "--version", "v1.2.3"}, Options{HTTPPort: 8080, Version: "v1.2.3"}},
		{"domain with rustfs", stubDocker, []string{"--domain", "notes.example.com", "--email", "me@example.com", "--rustfs"},
			Options{Domain: "notes.example.com", Email: "me@example.com", RustFS: true, Screenshots: true}},
		// "webbites" is taken on this machine: both write COMPOSE_PROJECT_NAME.
		{"project name taken", stubDockerTaken, nil, Options{Screenshots: true, Project: "webbites-0123abcd"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			want := runInstallShDocker(t, c.docker, c.sh...)
			o := c.opts
			if err := o.Normalize(); err != nil {
				t.Fatal(err)
			}
			got := parseEnv(t, GenerateEnv(o, time.Now()))
			if strings.Join(keys(got), " ") != strings.Join(keys(want), " ") {
				t.Fatalf("variables differ\n go: %v\n sh: %v", keys(got), keys(want))
			}
			for k, v := range want {
				if secretKeys[k] {
					if len(got[k]) != len(v) || got[k] == v {
						t.Errorf("%s: want a fresh value of length %d, got %q", k, len(v), got[k])
					}
					continue
				}
				if got[k] != v {
					t.Errorf("%s = %q, install.sh writes %q", k, got[k], v)
				}
			}
			if _, taken := want["COMPOSE_PROJECT_NAME"]; taken != (o.Project != "") {
				t.Errorf("COMPOSE_PROJECT_NAME written by install.sh: %v, by Go: %v", taken, o.Project != "")
			}
			if o.Project != "" && !projectName.MatchString(want["COMPOSE_PROJECT_NAME"]) {
				t.Errorf("install.sh's project name %q is not webbites-<8 hex>", want["COMPOSE_PROJECT_NAME"])
			}
			if o.RustFS && got["S3_ACCESS_KEY"] != got["RUSTFS_ACCESS_KEY"] {
				t.Errorf("S3_ACCESS_KEY must be the RustFS access key")
			}
		})
	}
}

func TestNormalize(t *testing.T) {
	bad := []Options{
		{Domain: "https://notes.example.com"},
		{Domain: "notes example"},
		{Domain: "notes.example.com", HTTPPort: 8080},
		{HTTPPort: 70000},
		{Email: "me@example.com\nEVIL=1"},
		{Email: "me@example.com\x00"},
		{Email: "me@example.com\r\nEVIL=1"},
		{Domain: "notes.example.com\nEVIL=1"},
		{Version: "1.2.3\nEVIL=1"},
		{Version: "1.2 3"},
		{Version: "../../x"},
		{Version: "1.2.3;rm"},
	}
	for _, o := range bad {
		if err := o.Normalize(); err == nil {
			t.Errorf("%+v: want an error", o)
		}
	}
	for _, v := range []string{"1.2.3", "v1.2.3", "1.2.3-rc.1", "edge", "oss_test", "latest"} {
		if o := (Options{Version: v}); o.Normalize() != nil {
			t.Errorf("version %q should be accepted", v)
		}
	}
	if o := (Options{Email: "me+tag@example.com"}); o.Normalize() != nil {
		t.Errorf("a plain email should be accepted")
	}
	o := Options{Domain: " Notes.Example.com ", Version: "v0.7.0"}
	if err := o.Normalize(); err != nil || o.Domain != "notes.example.com" || o.HTTPPort != 80 || o.Version != "0.7.0" {
		t.Errorf("got %+v, %v", o, err)
	}
}

func TestSetEnvValueKeepsPermissions(t *testing.T) {
	f := filepath.Join(t.TempDir(), ".env")
	_ = os.WriteFile(f, []byte("A=1\nWEBBITES_VERSION=0.7.0\nB=2\n"), 0o600)
	if err := SetEnvValue(f, "WEBBITES_VERSION", "0.8.0"); err != nil {
		t.Fatal(err)
	}
	if err := SetEnvValue(f, "NEW", "x"); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(f)
	if string(data) != "A=1\nWEBBITES_VERSION=0.8.0\nB=2\nNEW=x\n" {
		t.Errorf("got %q", data)
	}
	if info, _ := os.Stat(f); runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Errorf("permissions changed to %v", info.Mode().Perm())
	}
}

func TestSemverNewer(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{{"0.8.0", "0.7.9", true}, {"0.7.10", "0.7.9", true}, {"0.7.0", "0.7.0", false}, {"0.6.9", "0.7.0", false}, {"1.0.0", "latest", true}} {
		if got := semverNewer(c.a, c.b); got != c.want {
			t.Errorf("semverNewer(%s, %s) = %v", c.a, c.b, got)
		}
	}
}

func TestReleaseTag(t *testing.T) {
	for tag, ok := range map[string]bool{"v0.7.0": true, "v10.2.33": true, "v0.5": false, "0.6.1": false, "v1.0.0-rc.1": false} {
		if releaseTag.MatchString(tag) != ok {
			t.Errorf("%s: want match=%v", tag, ok)
		}
	}
}

func TestDownloadDeployFilesKeepsPrevious(t *testing.T) {
	deploy, _ := filepath.Abs("../../deploy")
	t.Setenv("WEBBITES_SOURCE", "file://"+filepath.ToSlash(deploy))
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "Caddyfile"), []byte("old"), 0o644)
	if err := DownloadDeployFiles(t.Context(), dir, "0.7.0", os.Stdout); err != nil {
		t.Fatal(err)
	}
	for _, f := range deployFiles {
		if _, err := os.Stat(filepath.Join(dir, f)); err != nil {
			t.Errorf("%s missing", f)
		}
	}
	if old, _ := os.ReadFile(filepath.Join(dir, ".previous", "Caddyfile")); string(old) != "old" {
		t.Errorf(".previous/Caddyfile = %q", old)
	}
}

var projectName = regexp.MustCompile(`^webbites-[0-9a-f]{8}$`)

func TestNewProjectName(t *testing.T) {
	a, b := NewProjectName(), NewProjectName()
	if !projectName.MatchString(a) || a == b {
		t.Errorf("got %q and %q", a, b)
	}
}

// install.sh run again where a .env exists changes nothing, whether or not the name is taken.
func TestInstallShKeepsExistingEnv(t *testing.T) {
	dir := t.TempDir()
	if out, err := installShRun(t, dir, stubDocker); err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
	first, _ := os.ReadFile(filepath.Join(dir, ".env"))
	out, err := installShRun(t, dir, stubDockerTaken)
	if err != nil || !strings.Contains(out, "already exists") {
		t.Fatalf("%v\n%s", err, out)
	}
	if again, _ := os.ReadFile(filepath.Join(dir, ".env")); string(again) != string(first) || strings.Contains(string(again), "COMPOSE_PROJECT_NAME") {
		t.Errorf(".env changed on the second run")
	}
}

// install.sh says so when it picks a project name of its own.
func TestInstallShAnnouncesProjectName(t *testing.T) {
	dir := t.TempDir()
	out, err := installShRun(t, dir, stubDockerTaken)
	if err != nil || !strings.Contains(out, "COMPOSE_PROJECT_NAME=webbites-") {
		t.Fatalf("%v\n%s", err, out)
	}
}

// Values that end up on a line of .env must be one line, and a version a plain name.
func TestInstallShRejectsUnsafeValues(t *testing.T) {
	cases := []struct {
		name string
		args []string
		want string
	}{
		{"email with a line break", []string{"--email", "me@example.com\nEVIL=1"}, "email"},
		{"email with a control character", []string{"--email", "me@example.com\x1b[0m"}, "email"},
		{"domain with a line break", []string{"--domain", "notes.example.com\nEVIL=1"}, "domain"},
		{"domain with a character a host name cannot have", []string{"--domain", "notes.example.com#x"}, "host name"},
		{"version with a line break", []string{"--version", "1.2.3\nEVIL=1"}, "--version"},
		{"version with a shell character", []string{"--version", "1.2.3;rm"}, "--version"},
		{"empty version", []string{"--version", "v"}, "--version"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			dir := t.TempDir()
			out, err := installShRun(t, dir, stubDocker, c.args...)
			if err == nil || !strings.Contains(out, c.want) {
				t.Fatalf("want an error mentioning %q, got %v\n%s", c.want, err, out)
			}
			if _, statErr := os.Stat(filepath.Join(dir, ".env")); statErr == nil {
				t.Errorf(".env was written")
			}
		})
	}
	// and the ordinary ones still pass
	dir := t.TempDir()
	if out, err := installShRun(t, dir, stubDocker, "--email", "me+tag@example.com", "--version", "v1.2.3-rc.1", "--domain", "notes.example.com"); err != nil {
		t.Fatalf("%v\n%s", err, out)
	}
}
