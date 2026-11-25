package main

// Which WebBites release to run, and its deployment files. Same rules as deploy/get.sh.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const repo = "elrumo/webbites_public"

// The files a WebBites install consists of, besides the .env it writes.
var deployFiles = []string{"docker-compose.yml", "Caddyfile", "install.sh", ".env.example"}

// Release tags are vX.Y.Z. The repository also has older tags of another form (the old macOS app's)
// and pre-releases (vX.Y.Z-rc.N); neither matches.
var releaseTag = regexp.MustCompile(`^v(\d+\.\d+\.\d+)$`)

var httpClient = &http.Client{Timeout: 60 * time.Second}

// LatestVersion asks GitHub for the newest release, e.g. "0.7.0".
func LatestVersion(ctx context.Context) (string, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/repos/"+repo+"/releases?per_page=30", nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	res, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("could not reach GitHub: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GitHub answered %s", res.Status)
	}
	var releases []struct {
		Tag        string `json:"tag_name"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
	}
	if err := json.NewDecoder(res.Body).Decode(&releases); err != nil {
		return "", err
	}
	for _, r := range releases { // newest first
		if m := releaseTag.FindStringSubmatch(r.Tag); m != nil && !r.Draft && !r.Prerelease {
			return m[1], nil
		}
	}
	return "", fmt.Errorf("no WebBites release has been published yet")
}

// sourceBase is where a version's deployment files are downloaded from. WEBBITES_SOURCE overrides it
// (a branch for testing, or file:///path/to/deploy for a local checkout).
func sourceBase(version string) string {
	if s := os.Getenv("WEBBITES_SOURCE"); s != "" {
		return strings.TrimRight(s, "/")
	}
	return "https://raw.githubusercontent.com/" + repo + "/v" + version + "/deploy"
}

func fetch(ctx context.Context, rawURL string) ([]byte, error) {
	if strings.HasPrefix(rawURL, "file://") {
		u, err := url.Parse(rawURL)
		if err != nil {
			return nil, err
		}
		return os.ReadFile(filepath.FromSlash(u.Path))
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	res, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s answered %s", rawURL, res.Status)
	}
	return io.ReadAll(res.Body)
}

// FetchDeployFiles downloads a version's deployment files into memory, without touching any folder.
func FetchDeployFiles(ctx context.Context, version string, log io.Writer) (map[string][]byte, error) {
	base := sourceBase(version)
	fmt.Fprintf(log, "Downloading WebBites %s deployment files...\n", version)
	contents := map[string][]byte{}
	for _, f := range deployFiles {
		data, err := fetch(ctx, base+"/"+f)
		if err != nil {
			return nil, fmt.Errorf("could not download %s: %w", f, err)
		}
		if len(data) == 0 {
			return nil, fmt.Errorf("%s from %s is empty", f, base)
		}
		contents[f] = data
	}
	return contents, nil
}

// WriteDeployFiles puts deployment files in dir. Files already there are kept in dir/.previous
// first (an upgrade), so a bad release can be rolled back by hand.
func WriteDeployFiles(dir string, contents map[string][]byte) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for _, f := range deployFiles {
		path := filepath.Join(dir, f)
		if old, err := os.ReadFile(path); err == nil {
			_ = os.MkdirAll(filepath.Join(dir, ".previous"), 0o755)
			_ = os.WriteFile(filepath.Join(dir, ".previous", f), old, 0o644)
		}
		mode := os.FileMode(0o644)
		if f == "install.sh" {
			mode = 0o755
		}
		if err := os.WriteFile(path, contents[f], mode); err != nil {
			return err
		}
	}
	return nil
}

// DownloadDeployFiles fetches a version's deployment files and puts them in dir.
func DownloadDeployFiles(ctx context.Context, dir, version string, log io.Writer) error {
	contents, err := FetchDeployFiles(ctx, version, log)
	if err != nil {
		return err
	}
	return WriteDeployFiles(dir, contents)
}
