package main

// The .env a new install starts with. This is deploy/install.sh written in Go (Windows has no sh),
// so the two must agree: env_test.go runs install.sh and compares the variables it writes with
// these. Change one, change the other.

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"
)

// Options are the installer's questions.
type Options struct {
	Dir         string `json:"dir"`
	Domain      string `json:"domain"`      // a host name, or "localhost" to try it on this computer
	Email       string `json:"email"`       // the only address that may become the administrator (optional)
	HTTPPort    int    `json:"httpPort"`    // localhost only; a domain needs 80
	Screenshots bool   `json:"screenshots"` // the screenshot service (about 1 GB of RAM)
	RustFS      bool   `json:"rustfs"`      // files in the bundled S3 store instead of MongoDB
	Version     string `json:"version"`     // image version to pin, e.g. 0.7.0
}

var hostName = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$`)

// Normalize fills in defaults and checks the answers.
func (o *Options) Normalize() error {
	o.Domain = strings.TrimSpace(strings.ToLower(o.Domain))
	if o.Domain == "" {
		o.Domain = "localhost"
	}
	if strings.HasPrefix(o.Domain, "http://") || strings.HasPrefix(o.Domain, "https://") {
		return fmt.Errorf("give the host name only, for example notes.example.com (no http://)")
	}
	if !hostName.MatchString(o.Domain) {
		return fmt.Errorf("that doesn't look like a host name: %s", o.Domain)
	}
	if o.HTTPPort == 0 {
		o.HTTPPort = 80
	}
	if o.HTTPPort < 1 || o.HTTPPort > 65535 {
		return fmt.Errorf("the port must be between 1 and 65535")
	}
	if o.Domain != "localhost" && o.HTTPPort != 80 {
		return fmt.Errorf("a domain needs port 80 for its HTTPS certificate; a different port is for localhost only")
	}
	o.Email = strings.TrimSpace(o.Email)
	o.Version = strings.TrimPrefix(strings.TrimSpace(o.Version), "v")
	if o.Version == "" {
		o.Version = "latest"
	}
	return nil
}

// Addresses returns PUBLIC_URL, SITE_ADDRESS and HTTPS_PORT for the options.
func (o Options) Addresses() (publicURL, siteAddress string, httpsPort int) {
	httpsPort = 443
	if o.HTTPPort != 80 {
		httpsPort = 8443
	}
	if o.Domain == "localhost" {
		publicURL = "http://localhost"
		if o.HTTPPort != 80 {
			publicURL = fmt.Sprintf("http://localhost:%d", o.HTTPPort)
		}
		return publicURL, "http://localhost", httpsPort
	}
	return "https://" + o.Domain, o.Domain, httpsPort
}

func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err) // the OS random source failing is not something to carry on from
	}
	return hex.EncodeToString(b)
}

// GenerateEnv returns the contents of a new .env, with freshly generated secrets.
func GenerateEnv(o Options, now time.Time) string {
	publicURL, siteAddress, httpsPort := o.Addresses()
	var profiles []string
	if o.Screenshots {
		profiles = append(profiles, "screenshots")
	}
	if o.RustFS {
		profiles = append(profiles, "rustfs")
	}
	rustfsAccess, rustfsSecret := randHex(10), randHex(24)

	var b strings.Builder
	fmt.Fprintf(&b, "# Written by the WebBites installer on %s. Keep this file private and back it up.\n\n", now.UTC().Format("2006-01-02T15:04:05Z"))
	line := func(k, v string) { fmt.Fprintf(&b, "%s=%s\n", k, v) }
	line("PUBLIC_URL", publicURL)
	line("SITE_ADDRESS", siteAddress)
	line("HTTP_PORT", fmt.Sprint(o.HTTPPort))
	line("HTTPS_PORT", fmt.Sprint(httpsPort))
	line("WEBBITES_VERSION", o.Version)
	line("COMPOSE_PROFILES", strings.Join(profiles, ","))
	line("INITIAL_ADMIN_EMAIL", o.Email)
	b.WriteString("\n")
	line("MONGO_PASSWORD", randHex(24))
	line("PARSE_APP_ID", "wb_"+randHex(8))
	line("PARSE_JS_KEY", randHex(24))
	line("PARSE_MASTER_KEY", randHex(32))
	line("CUSTOM_API_KEY", randHex(32))
	line("AUDIO_TOKEN_SECRET", randHex(32))
	line("SHARE_LINK_SECRET", randHex(32))
	line("BACKUP_ENCRYPTION_KEY", randHex(32))
	line("SETTINGS_ENCRYPTION_KEY", randHex(32))
	line("MEILI_MASTER_KEY", randHex(24))
	line("SCREENSHOT_API_KEY", randHex(24))
	line("RUSTFS_ACCESS_KEY", rustfsAccess)
	line("RUSTFS_SECRET_KEY", rustfsSecret)
	b.WriteString("\n")
	line("APP_NAME", "WebBites")
	if o.Screenshots {
		line("SCREENSHOT_SERVICE_URL", "http://screenshot:3000")
	}
	if o.RustFS {
		b.WriteString("\n# Files live in the bundled RustFS (see docker-compose.yml, profile \"rustfs\").\n")
		line("FILES_DRIVER", "s3")
		line("S3_BUCKET", "webbites")
		line("S3_ENDPOINT_URL", "http://rustfs:9000")
		line("S3_REGION", "us-east-1")
		line("S3_PUBLIC_URL", publicURL+"/s3/webbites")
		line("S3_ACCESS_KEY", rustfsAccess)
		line("S3_SECRET_KEY", rustfsSecret)
	}
	b.WriteString("\n# Email, AI, storage and the other optional settings are described in .env.example.\n")
	b.WriteString("# Copy any you need from there into this file.\n")
	return b.String()
}

// ReadEnv parses KEY=VALUE lines (no quoting, as the installer writes them).
func ReadEnv(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	env := map[string]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if k, v, ok := strings.Cut(line, "="); ok {
			env[strings.TrimSpace(k)] = v
		}
	}
	return env, sc.Err()
}

// SetEnvValue changes (or appends) one variable, rewriting the file in place so it keeps its
// permissions.
func SetEnvValue(path, key, value string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	lines := strings.Split(string(data), "\n")
	found := false
	for i, l := range lines {
		if strings.HasPrefix(l, key+"=") {
			lines[i] = key + "=" + value
			found = true
		}
	}
	out := strings.Join(lines, "\n")
	if !found {
		if !strings.HasSuffix(out, "\n") {
			out += "\n"
		}
		out += key + "=" + value + "\n"
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	return os.WriteFile(path, []byte(out), info.Mode().Perm())
}
