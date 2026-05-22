package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"
)

// runningProc tracks a spawned tursodb subprocess together with the local
// port it is listening on. `exited` is closed by the single reaper
// goroutine when `cmd.Wait()` returns — callers that need to wait for
// shutdown should select on this channel instead of calling Wait again
// (the Go runtime panics or hangs on a second Wait against the same
// `exec.Cmd`).
type runningProc struct {
	port   int
	cmd    *exec.Cmd
	exited chan struct{}
}

// Supervisor owns tursodb subprocess lifecycle: it allocates internal ports,
// spawns tursodb with the right arguments, waits for the port to be ready,
// stops processes on shutdown, and exposes lookup by namespace name to the
// proxy layer.
//
// Subprocesses are spawned with a supervisor-scoped context, NOT the caller's
// request context. Tying tursodb's lifetime to an HTTP request is wrong —
// when the request returns, `exec.CommandContext` would SIGKILL the freshly
// spawned process and the next request would have to respawn it. The
// `procCtx` field lives until `Stop()` is invoked.
type Supervisor struct {
	cfg   *Config
	store *Store
	log   *slog.Logger

	procCtx    context.Context
	procCancel context.CancelFunc

	mu       sync.Mutex
	procs    map[string]*runningProc // name -> running process
	nameLock map[string]*sync.Mutex  // per-name lock for serialized auto-create
	usedPort map[int]bool            // currently-allocated backend ports
	nextPort int
}

// NewSupervisor creates an empty supervisor. Call Restore to bring back
// processes for previously-known namespaces.
func NewSupervisor(cfg *Config, store *Store, log *slog.Logger) *Supervisor {
	ctx, cancel := context.WithCancel(context.Background())
	return &Supervisor{
		cfg:        cfg,
		store:      store,
		log:        log,
		procCtx:    ctx,
		procCancel: cancel,
		procs:      make(map[string]*runningProc),
		nameLock:   make(map[string]*sync.Mutex),
		usedPort:   make(map[int]bool),
		nextPort:   cfg.BackendPortStart,
	}
}

// Restore re-spawns tursodb processes for every namespace known to the
// store. Called once on boot. Errors for individual namespaces are logged
// but do not abort the boot — a single bad namespace should not take the
// whole server down.
func (s *Supervisor) Restore(ctx context.Context) {
	for _, ns := range s.store.List() {
		if err := s.ensure(ctx, ns.Name, ns.Origin); err != nil {
			s.log.Error("restore namespace failed",
				slog.String("name", ns.Name),
				slog.String("err", err.Error()))
		}
	}
}

// Stop gracefully shuts down every supervised tursodb process. Sends
// SIGTERM, then SIGKILL after the timeout. Also cancels the supervisor
// context so any in-flight `EnsureRunning` calls return promptly.
func (s *Supervisor) Stop(timeout time.Duration) {
	s.mu.Lock()
	procs := make(map[string]*runningProc, len(s.procs))
	for k, v := range s.procs {
		procs[k] = v
	}
	s.mu.Unlock()

	var wg sync.WaitGroup
	for name, p := range procs {
		wg.Add(1)
		go func(name string, p *runningProc) {
			defer wg.Done()
			s.stopProc(name, p, timeout)
		}(name, p)
	}
	wg.Wait()
	s.procCancel()
}

func (s *Supervisor) stopProc(name string, p *runningProc, timeout time.Duration) {
	if p.cmd == nil || p.cmd.Process == nil {
		return
	}
	pid := p.cmd.Process.Pid
	if err := p.cmd.Process.Signal(syscall.SIGTERM); err != nil {
		s.log.Warn("SIGTERM failed", slog.String("name", name), slog.Int("pid", pid), slog.String("err", err.Error()))
	}
	// The reaper goroutine (started by `ensureLocked`) owns `cmd.Wait()`
	// and closes `p.exited` when the process leaves. We never call Wait
	// here — calling it twice deadlocks the os/exec package.
	select {
	case <-p.exited:
	case <-time.After(timeout):
		s.log.Warn("SIGTERM timed out, sending SIGKILL", slog.String("name", name), slog.Int("pid", pid))
		_ = p.cmd.Process.Kill()
		<-p.exited
	}
	s.mu.Lock()
	delete(s.procs, name)
	delete(s.usedPort, p.port)
	s.mu.Unlock()
}

// Lookup returns the backend port for a running namespace, or 0 if not
// running. Does not auto-create.
func (s *Supervisor) Lookup(name string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if p, ok := s.procs[name]; ok {
		return p.port
	}
	return 0
}

// EnsureRunning guarantees a tursodb process is running for the given
// namespace, spawning one if needed. Returns the backend port. The `origin`
// argument records intent for new namespaces — existing ones keep their
// stored origin.
func (s *Supervisor) EnsureRunning(ctx context.Context, name string, origin NamespaceOrigin) (int, error) {
	if err := ValidateNamespaceName(name); err != nil {
		return 0, err
	}
	if port := s.Lookup(name); port != 0 {
		return port, nil
	}
	return s.ensureLocked(ctx, name, origin)
}

func (s *Supervisor) ensure(ctx context.Context, name string, origin NamespaceOrigin) error {
	_, err := s.EnsureRunning(ctx, name, origin)
	return err
}

func (s *Supervisor) ensureLocked(ctx context.Context, name string, origin NamespaceOrigin) (int, error) {
	// Acquire per-name lock to serialize concurrent first-touch requests
	// for the same namespace. Each name gets its own mutex so unrelated
	// namespaces never block each other.
	lock := s.getOrCreateNameLock(name)
	lock.Lock()
	defer lock.Unlock()

	// Double-check after acquiring the lock — another goroutine may have
	// spawned the namespace while we were waiting.
	if port := s.Lookup(name); port != 0 {
		return port, nil
	}

	// Enforce MaxNamespaces (0 = unlimited).
	if s.cfg.MaxNamespaces > 0 {
		s.mu.Lock()
		count := len(s.procs)
		s.mu.Unlock()
		if count >= s.cfg.MaxNamespaces {
			return 0, fmt.Errorf("max namespaces reached (%d)", s.cfg.MaxNamespaces)
		}
	}

	port, err := s.allocPort()
	if err != nil {
		return 0, err
	}

	dbPath := filepath.Join(s.cfg.DataDir, name+".db")
	addr := "127.0.0.1:" + strconv.Itoa(port)

	// Use the supervisor-scoped context (not the caller's `ctx`) so the
	// child process survives the HTTP request that triggered creation.
	// `ctx` is still honored by `waitForPort` below — if the caller
	// cancels, we abandon the wait but leave tursodb running for the
	// next caller.
	cmd := exec.CommandContext(s.procCtx, s.cfg.TursodbBin, dbPath, "--sync-server", addr)
	cmd.Stdout = newLogWriter(s.log, "tursodb."+name, slog.LevelInfo)
	cmd.Stderr = newLogWriter(s.log, "tursodb."+name, slog.LevelWarn)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	if err := cmd.Start(); err != nil {
		s.releasePort(port)
		return 0, fmt.Errorf("start tursodb for %q: %w", name, err)
	}

	if err := waitForPort("127.0.0.1", port, s.cfg.StartupTimeout); err != nil {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
		s.releasePort(port)
		return 0, fmt.Errorf("tursodb %q failed to listen on %d: %w", name, port, err)
	}

	exited := make(chan struct{})
	s.mu.Lock()
	s.procs[name] = &runningProc{port: port, cmd: cmd, exited: exited}
	s.mu.Unlock()

	// Reaper goroutine: owns `cmd.Wait()`. When the child exits
	// (cleanly via SIGTERM or unexpectedly), we close `exited` so any
	// `stopProc` caller can synchronize on it, then clear our map so
	// the next access respawns the process.
	go func() {
		err := cmd.Wait()
		close(exited)
		s.log.Warn("tursodb exited",
			slog.String("name", name),
			slog.Int("port", port),
			slog.String("err", errString(err)))
		s.mu.Lock()
		if cur, ok := s.procs[name]; ok && cur.cmd == cmd {
			delete(s.procs, name)
		}
		s.releasePortLocked(port)
		s.mu.Unlock()
	}()

	// Ensure the namespace is in the store (idempotent).
	ns := s.store.Get(name)
	if ns == nil {
		_, err := s.store.Add(&Namespace{
			Name:   name,
			Origin: origin,
			// Explicit creates are locked-by-default; auto-creates are
			// unlocked so the GC can sweep them when idle.
			Locked: origin == OriginExplicit,
		})
		if err != nil {
			s.log.Error("persist namespace failed", slog.String("name", name), slog.String("err", err.Error()))
		}
	}
	s.store.SetRuntime(name, port, cmd.Process.Pid)

	s.log.Info("namespace running",
		slog.String("name", name),
		slog.Int("port", port),
		slog.Int("pid", cmd.Process.Pid),
		slog.String("origin", string(origin)))

	return port, nil
}

// Destroy stops the process for `name` and removes the namespace from the
// store. The underlying database file is moved to `<dataDir>/archive/` so
// it can be retrieved if needed. Returns the path of the archived file.
func (s *Supervisor) Destroy(ctx context.Context, name string) (string, error) {
	if err := ValidateNamespaceName(name); err != nil {
		return "", err
	}
	s.mu.Lock()
	p, running := s.procs[name]
	s.mu.Unlock()
	if running {
		s.stopProc(name, p, 5*time.Second)
	}

	if _, err := s.store.Remove(name); err != nil {
		return "", err
	}

	// Move database files to archive (best-effort).
	archiveDir := filepath.Join(s.cfg.DataDir, "archive", name+"."+time.Now().UTC().Format("20060102T150405Z"))
	if err := os.MkdirAll(archiveDir, 0o755); err != nil {
		return "", fmt.Errorf("create archive dir: %w", err)
	}

	matches, err := filepath.Glob(filepath.Join(s.cfg.DataDir, name+".db*"))
	if err != nil {
		return archiveDir, err
	}
	for _, src := range matches {
		dst := filepath.Join(archiveDir, filepath.Base(src))
		if err := os.Rename(src, dst); err != nil {
			s.log.Warn("archive rename failed",
				slog.String("src", src),
				slog.String("dst", dst),
				slog.String("err", err.Error()))
		}
	}

	s.log.Info("namespace destroyed", slog.String("name", name), slog.String("archive", archiveDir))
	return archiveDir, nil
}

func (s *Supervisor) getOrCreateNameLock(name string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	if m, ok := s.nameLock[name]; ok {
		return m
	}
	m := &sync.Mutex{}
	s.nameLock[name] = m
	return m
}

func (s *Supervisor) allocPort() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := 0; i <= (s.cfg.BackendPortEnd - s.cfg.BackendPortStart); i++ {
		p := s.nextPort
		s.nextPort++
		if s.nextPort > s.cfg.BackendPortEnd {
			s.nextPort = s.cfg.BackendPortStart
		}
		if !s.usedPort[p] && !portInUse(p) {
			s.usedPort[p] = true
			return p, nil
		}
	}
	return 0, errors.New("no free backend port in configured range")
}

func (s *Supervisor) releasePort(port int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.releasePortLocked(port)
}

func (s *Supervisor) releasePortLocked(port int) {
	delete(s.usedPort, port)
}

// waitForPort polls a TCP port until it accepts a connection or `timeout`
// elapses. Used after spawning tursodb to confirm it is ready for HTTP
// traffic before returning success to the caller.
func waitForPort(host string, port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	addr := host + ":" + strconv.Itoa(port)
	for {
		conn, err := net.DialTimeout("tcp", addr, 200*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("port %d not ready within %s: %w", port, timeout, err)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// portInUse returns true if `port` is already bound by another process on
// 127.0.0.1. Useful when the supervisor restarts and the OS has not yet
// released sockets used by a prior generation.
func portInUse(port int) bool {
	ln, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		return true
	}
	_ = ln.Close()
	return false
}

func errString(err error) string {
	if err == nil {
		return "<nil>"
	}
	return err.Error()
}

// logWriter adapts an io.Writer interface (used by exec.Cmd.Stdout/Stderr)
// to slog. Each line emitted by the subprocess becomes one slog record.
type logWriter struct {
	log   *slog.Logger
	src   string
	level slog.Level
	buf   []byte
}

func newLogWriter(log *slog.Logger, src string, level slog.Level) *logWriter {
	return &logWriter{log: log, src: src, level: level}
}

func (w *logWriter) Write(p []byte) (int, error) {
	w.buf = append(w.buf, p...)
	for {
		idx := -1
		for i, b := range w.buf {
			if b == '\n' {
				idx = i
				break
			}
		}
		if idx < 0 {
			break
		}
		line := string(w.buf[:idx])
		w.buf = w.buf[idx+1:]
		w.log.Log(context.Background(), w.level, line, slog.String("src", w.src))
	}
	return len(p), nil
}
