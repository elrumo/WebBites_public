//go:build windows

package main

import (
	"os"
	"os/exec"
	"syscall"
)

const createNoWindow = 0x08000000

// hideWindow keeps the console programs this app runs (docker) from opening a window each.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}

// attachConsole lets the CLI print when the app (built as a GUI program, so double-clicking it opens
// no console) is run from a terminal: it borrows the parent's console, if there is one.
func attachConsole() {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	attach := kernel32.NewProc("AttachConsole")
	const attachParentProcess = ^uintptr(0) // (DWORD)-1
	if r, _, _ := attach.Call(attachParentProcess); r == 0 {
		return
	}
	if f, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0); err == nil {
		os.Stdout, os.Stderr = f, f
	}
	if f, err := os.OpenFile("CONIN$", os.O_RDONLY, 0); err == nil {
		os.Stdin = f
	}
}
