package main

// The setup page: a small web UI on 127.0.0.1, opened in the default browser.
//
// It can run Docker commands, so it only answers this machine (127.0.0.1), only with the random
// token of this launch (in the URL the app opens, then sent as X-Token), only for its own Host header
// (DNS rebinding), and only JSON POSTs (a form on another site cannot send one).

import (
	"context"
	"crypto/subtle"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

//go:embed ui
var uiFiles embed.FS

type UIServer struct {
	URL   string // with the token, what the browser opens
	token string
	host  string
	m     *Manager
	srv   *http.Server
}

func StartUI(m *Manager) (*UIServer, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	u := &UIServer{token: randHex(16), host: ln.Addr().String(), m: m}
	u.URL = fmt.Sprintf("http://%s/?t=%s", u.host, u.token)

	mux := http.NewServeMux()
	static, _ := fs.Sub(uiFiles, "ui")
	mux.HandleFunc("GET /{$}", u.page(static))
	mux.Handle("GET /assets/", http.FileServer(http.FS(static)))
	mux.HandleFunc("GET /api/state", u.api(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, m.State(r.Context()))
	}))
	mux.HandleFunc("POST /api/install", u.api(func(w http.ResponseWriter, r *http.Request) {
		var o Options
		if err := json.NewDecoder(r.Body).Decode(&o); err != nil {
			writeErr(w, 400, err)
			return
		}
		answer(w, m.Install(o, false))
	}))
	mux.HandleFunc("POST /api/dir", u.api(func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Dir string }
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeErr(w, 400, err)
			return
		}
		answer(w, m.SetDir(body.Dir))
	}))
	mux.HandleFunc("POST /api/start", u.api(func(w http.ResponseWriter, r *http.Request) { answer(w, m.Start(false)) }))
	mux.HandleFunc("POST /api/stop", u.api(func(w http.ResponseWriter, r *http.Request) { answer(w, m.Stop(false)) }))
	mux.HandleFunc("POST /api/restart", u.api(func(w http.ResponseWriter, r *http.Request) { answer(w, m.Restart(false)) }))
	mux.HandleFunc("POST /api/update", u.api(func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Version string }
		_ = json.NewDecoder(r.Body).Decode(&body)
		answer(w, m.Update(body.Version, false))
	}))
	mux.HandleFunc("POST /api/open-folder", u.api(func(w http.ResponseWriter, r *http.Request) {
		answer(w, OpenFolder(m.Dir()))
	}))
	mux.HandleFunc("GET /api/logs", u.api(func(w http.ResponseWriter, r *http.Request) {
		out, err := m.Logs(r.Context(), r.URL.Query().Get("service"), 300)
		if err != nil && out == "" {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]string{"logs": out})
	}))
	mux.HandleFunc("GET /api/events", u.api(u.events))

	u.srv = &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = u.srv.Serve(ln) }()
	rememberUI(u)
	return u, nil
}

func (u *UIServer) Close() {
	_ = os.Remove(uiFile())
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = u.srv.Shutdown(ctx)
}

func (u *UIServer) hostOK(r *http.Request) bool {
	return r.Host == u.host || r.Host == strings.Replace(u.host, "127.0.0.1", "localhost", 1)
}

func (u *UIServer) tokenOK(given string) bool {
	return subtle.ConstantTimeCompare([]byte(given), []byte(u.token)) == 1
}

func (u *UIServer) page(static fs.FS) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !u.hostOK(r) || !u.tokenOK(r.URL.Query().Get("t")) {
			http.Error(w, "Open this page from the WebBites Server menu.", http.StatusForbidden)
			return
		}
		data, _ := fs.ReadFile(static, "index.html")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:")
		w.Header().Set("Referrer-Policy", "no-referrer")
		_, _ = w.Write(data)
	}
}

func (u *UIServer) api(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("X-Token")
		if token == "" && r.Method == http.MethodGet {
			token = r.URL.Query().Get("t") // EventSource can't send headers
		}
		if !u.hostOK(r) || !u.tokenOK(token) {
			writeErr(w, 403, fmt.Errorf("forbidden"))
			return
		}
		if r.Method == http.MethodPost && !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			writeErr(w, 415, fmt.Errorf("JSON only"))
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		h(w, r)
	}
}

// events streams job output (Server-Sent Events).
func (u *UIServer) events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, 500, fmt.Errorf("streaming unsupported"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	ch, cancel := u.m.Subscribe()
	defer cancel()
	ping := time.NewTicker(20 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case line := <-ch:
			if line == "\x00end" {
				fmt.Fprint(w, "event: end\ndata: \n\n")
			} else {
				data, _ := json.Marshal(line)
				fmt.Fprintf(w, "data: %s\n\n", data)
			}
			flusher.Flush()
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func answer(w http.ResponseWriter, err error) {
	if err != nil {
		writeErr(w, 409, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// ---- one app at a time -----------------------------------------------------------------------
// The running app writes its setup page's address here; a second launch opens that page instead
// of starting another app.

func uiFile() string { return filepath.Join(configDir(), "ui-url") }

func rememberUI(u *UIServer) {
	_ = os.MkdirAll(configDir(), 0o700)
	_ = os.WriteFile(uiFile(), []byte(u.URL), 0o600)
}

// RunningUI returns the setup page of an app that is already running, if any.
func RunningUI() string {
	data, err := os.ReadFile(uiFile())
	if err != nil {
		return ""
	}
	pageURL := strings.TrimSpace(string(data))
	host, token, ok := strings.Cut(strings.TrimPrefix(pageURL, "http://"), "/?t=")
	if !ok {
		return ""
	}
	req, _ := http.NewRequest(http.MethodGet, "http://"+host+"/api/state", nil)
	req.Header.Set("X-Token", token)
	client := &http.Client{Timeout: 3 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return ""
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		return ""
	}
	return pageURL
}
