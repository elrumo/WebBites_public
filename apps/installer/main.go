// WebBites Server: installs and runs a self-hosted WebBites with Docker, from a menu-bar app (macOS),
// a notification-area app (Windows, Linux desktops), or the command line (any machine, servers
// included). It does what deploy/get.sh and deploy/install.sh do, without a shell.
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strconv"
	"strings"
)

var appVersion = "dev" // set at build time: -ldflags "-X main.appVersion=0.7.0"

const usage = `WebBites Server %s: run your own WebBites with Docker.

Without a command it opens the menu-bar app and its setup page (or, on a machine without a
desktop, the setup page alone; open the address it prints, through an SSH tunnel if remote).

Commands:
  install    set up WebBites in a folder and start it (asks a few questions)
  start      start WebBites
  stop       stop WebBites (it stays installed)
  restart    restart WebBites
  status     show whether it runs, its version and address
  update     move to the latest release (or --version x.y.z)
  logs       show recent logs (logs <service> for one: web, api, parse, mongo, ...)
  open       open WebBites in the browser
  ui         open the setup page without the menu-bar icon
  version    print this app's version

Every command takes --dir <folder> (default: the folder last used, or ~/WebBites).
Run "webbites-server install --help" for the install options.
`

func main() {
	if len(os.Args) > 1 {
		attachConsole() // Windows: print to the terminal the command was typed in
	}
	args := os.Args[1:]
	cmd := ""
	// A first word starting with "-" is a flag of the app itself (--dir), except these.
	if len(args) > 0 && (!strings.HasPrefix(args[0], "-") || isInfoFlag(args[0])) {
		cmd, args = args[0], args[1:]
	}
	if err := run(cmd, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return // "install --help": the flag package has printed the options
		}
		if _, shown := err.(shownError); !shown {
			fmt.Fprintln(os.Stderr, "Error:", err)
		}
		os.Exit(1)
	}
}

func isInfoFlag(a string) bool {
	switch a {
	case "-h", "-help", "--help", "--version":
		return true
	}
	return false
}

func run(cmd string, args []string) error {
	m := NewManager()
	fs := flag.NewFlagSet(cmd, flag.ContinueOnError)
	dir := fs.String("dir", "", "the WebBites folder")

	switch cmd {
	case "", "app":
		if err := fs.Parse(args); err != nil {
			return err
		}
		if err := useDir(m, *dir); err != nil {
			return err
		}
		return runApp(m, HasDesktop())

	case "ui":
		if err := fs.Parse(args); err != nil {
			return err
		}
		if err := useDir(m, *dir); err != nil {
			return err
		}
		return runApp(m, false)

	case "install":
		return cliInstall(m, fs, dir, args)

	case "start", "stop", "restart", "status", "open":
		if err := fs.Parse(args); err != nil {
			return err
		}
		if err := useDir(m, *dir); err != nil {
			return err
		}
		switch cmd {
		case "start":
			return following(m, func() error { return m.Start(true) })
		case "stop":
			return following(m, func() error { return m.Stop(true) })
		case "restart":
			return following(m, func() error { return m.Restart(true) })
		case "open":
			s := m.State(context.Background())
			if s.PublicURL == "" {
				return fmt.Errorf("no WebBites install in %s", m.Dir())
			}
			return OpenBrowser(s.PublicURL)
		default:
			return printStatus(m)
		}

	case "update":
		version := fs.String("version", "", "release to move to (default: the latest)")
		if err := fs.Parse(args); err != nil {
			return err
		}
		if err := useDir(m, *dir); err != nil {
			return err
		}
		return following(m, func() error { return m.Update(*version, true) })

	case "logs":
		tail := fs.Int("tail", 200, "how many lines")
		follow := fs.Bool("f", false, "keep following")
		if err := fs.Parse(args); err != nil {
			return err
		}
		if err := useDir(m, *dir); err != nil {
			return err
		}
		if !m.Installed() {
			return fmt.Errorf("no WebBites install in %s", m.Dir())
		}
		cargs := []string{"compose", "logs", "--tail", strconv.Itoa(*tail)}
		if *follow {
			cargs = append(cargs, "-f")
		}
		cargs = append(cargs, fs.Args()...)
		c := command(context.Background(), m.Dir(), "docker", cargs...)
		c.Stdout, c.Stderr = os.Stdout, os.Stderr
		return c.Run()

	case "version", "--version":
		fmt.Println(appVersion)
		return nil

	case "help", "-h", "-help", "--help":
		fmt.Printf(usage, appVersion)
		return nil
	}
	fmt.Fprintf(os.Stderr, usage, appVersion)
	return fmt.Errorf("unknown command %q", cmd)
}

func useDir(m *Manager, dir string) error {
	if dir == "" {
		return nil
	}
	return m.SetDir(dir)
}

// runApp shows the setup page, with the menu-bar icon when there is a desktop.
func runApp(m *Manager, tray bool) error {
	if url := RunningUI(); url != "" { // already running: show it instead of starting another
		fmt.Println(url)
		return OpenBrowser(url)
	}
	ui, err := StartUI(m)
	if err != nil {
		return err
	}
	if tray {
		RunTray(m, ui)
		return nil
	}
	fmt.Printf("WebBites Server is running. Open this address (it only answers on this machine):\n\n  %s\n\n", ui.URL)
	fmt.Println("On a remote server, tunnel it first: ssh -L <port>:127.0.0.1:<port> you@server")
	fmt.Println("Press Ctrl-C to stop the page (WebBites itself keeps running).")
	_ = OpenBrowser(ui.URL)
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	<-stop
	ui.Close()
	return nil
}

// following runs a job and prints its output as it comes.
func following(m *Manager, fn func() error) error {
	ch, cancel := m.Subscribe()
	defer cancel()
	done := make(chan struct{})
	go func() {
		for line := range ch {
			if line == "\x00end" {
				close(done)
				return
			}
			fmt.Println(line)
		}
	}()
	before := m.currentJob()
	err := fn()
	if m.currentJob() == before {
		return err // refused before any job started (busy, not installed, bad answers)
	}
	<-done // the job's output, its error included, has been printed
	if err != nil {
		return shownError{err}
	}
	return nil
}

// shownError has already been printed as part of a job's output.
type shownError struct{ error }

func printStatus(m *Manager) error {
	s := m.State(context.Background())
	fmt.Printf("Folder:   %s\n", s.Dir)
	if !s.Docker.Running {
		fmt.Printf("Docker:   %s\n", s.Docker.Problem)
	} else {
		fmt.Printf("Docker:   %s\n", s.Docker.Version)
	}
	if !s.Installed {
		fmt.Println("WebBites: not installed here (webbites-server install)")
		return nil
	}
	state := "stopped"
	if s.Running {
		state = "running"
	}
	fmt.Printf("WebBites: %s, version %s, at %s\n", state, s.Version, s.PublicURL)
	if s.Latest != "" && semverNewer(s.Latest, s.Version) {
		fmt.Printf("Update:   %s is available (webbites-server update)\n", s.Latest)
	}
	for _, sv := range s.Services {
		fmt.Printf("  %-14s %s\n", sv.Name, sv.Status)
	}
	return nil
}

func cliInstall(m *Manager, fs *flag.FlagSet, dir *string, args []string) error {
	o := Options{}
	fs.StringVar(&o.Domain, "domain", "", "public host name (default: localhost, to use it on this computer)")
	fs.StringVar(&o.Email, "email", "", "the only address that may become the administrator")
	fs.IntVar(&o.HTTPPort, "http-port", 0, "port on this computer for localhost (default 80)")
	fs.StringVar(&o.Version, "version", "latest", "release to install")
	noShots := fs.Bool("no-screenshots", false, "don't run the screenshot service (saves about 1 GB of RAM)")
	fs.BoolVar(&o.RustFS, "rustfs", false, "keep files in the bundled S3 store instead of MongoDB")
	yes := fs.Bool("yes", false, "accept the defaults, ask nothing")
	if err := fs.Parse(args); err != nil {
		return err
	}
	o.Screenshots = !*noShots
	o.Dir = *dir
	if o.Dir == "" {
		o.Dir = m.Dir()
	}

	interactive := !*yes && isTerminal(os.Stdin)
	if interactive {
		in := bufio.NewReader(os.Stdin)
		o.Dir = ask(in, "Folder", o.Dir)
		if o.Domain == "" {
			o.Domain = ask(in, "Domain name (localhost to use it on this computer)", "localhost")
		}
		if (o.Domain == "" || o.Domain == "localhost") && o.HTTPPort == 0 {
			def := strconv.Itoa(FreePort()) // 80, unless it or 443 is taken
			p, err := strconv.Atoi(ask(in, "Port on this computer", def))
			if err != nil {
				return fmt.Errorf("the port must be a number")
			}
			o.HTTPPort = p
		}
		if o.Email == "" {
			o.Email = ask(in, "Your email (only this address can become the administrator; empty to skip)", "")
		}
		if !*noShots {
			o.Screenshots = askYes(in, "Run the screenshot service (about 1 GB of RAM)?", true)
		}
		if !o.RustFS {
			o.RustFS = askYes(in, "Keep files in a bundled S3 store (RustFS) instead of MongoDB?", false)
		}
	} else if (o.Domain == "" || o.Domain == "localhost") && o.HTTPPort == 0 {
		o.HTTPPort = FreePort()
	}
	return following(m, func() error { return m.Install(o, true) })
}

func ask(in *bufio.Reader, prompt, def string) string {
	if def != "" {
		fmt.Printf("%s [%s]: ", prompt, def)
	} else {
		fmt.Printf("%s: ", prompt)
	}
	line, _ := in.ReadString('\n')
	if line = strings.TrimSpace(line); line == "" {
		return def
	}
	return line
}

func askYes(in *bufio.Reader, prompt string, def bool) bool {
	d := "no"
	if def {
		d = "yes"
	}
	switch strings.ToLower(ask(in, prompt, d)) {
	case "y", "yes":
		return true
	default:
		return false
	}
}

func isTerminal(f *os.File) bool {
	info, err := f.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

func sscanVersion(v string, out *[3]int) (int, error) {
	return fmt.Sscanf(v, "%d.%d.%d", &out[0], &out[1], &out[2])
}
