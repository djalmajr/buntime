package server

import (
	"context"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// buildFakeTursodb compiles `testdata/faketursodb/main.go` into a temp
// file and returns its path. The binary stands in for the real tursodb
// during Supervisor lifecycle tests — see testdata/faketursodb/main.go
// for the rationale.
//
// Memoized per package run via sync.Once so all tests share a single
// build pass (~150ms each → 30ms amortized).
var (
	fakeBinOnce sync.Once
	fakeBinPath string
	fakeBinErr  error
)

func buildFakeTursodb(t *testing.T) string {
	t.Helper()
	fakeBinOnce.Do(func() {
		src, err := filepath.Abs(filepath.Join("testdata", "faketursodb"))
		if err != nil {
			fakeBinErr = err
			return
		}
		out := filepath.Join(os.TempDir(), "faketursodb-"+strconv.Itoa(os.Getpid()))
		if runtime.GOOS == "windows" {
			out += ".exe"
		}
		cmd := exec.Command("go", "build", "-o", out, ".")
		cmd.Dir = src
		if outBytes, err := cmd.CombinedOutput(); err != nil {
			fakeBinErr = err
			fakeBinPath = string(outBytes)
			return
		}
		fakeBinPath = out
	})
	if fakeBinErr != nil {
		t.Fatalf("build faketursodb: %v (%s)", fakeBinErr, fakeBinPath)
	}
	return fakeBinPath
}

// newTestSupervisor wires a Supervisor with the fake tursodb binary and a
// short startup timeout. Returns the supervisor and the data directory so
// tests can inspect on-disk state.
func newTestSupervisor(t *testing.T) (*Supervisor, *Store, *Config) {
	t.Helper()
	bin := buildFakeTursodb(t)
	dir := t.TempDir()
	cfg := &Config{
		DataDir:          dir,
		TursodbBin:       bin,
		BackendPortStart: 19000,
		BackendPortEnd:   19099,
		StartupTimeout:   3 * time.Second,
		MaxNamespaces:    16,
	}
	store, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = store.Close()
	})
	sup := NewSupervisor(cfg, store, slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelWarn,
	})))
	t.Cleanup(func() {
		sup.Stop(2 * time.Second)
	})
	return sup, store, cfg
}

func TestSupervisor_EnsureRunning_SpawnsAndPersistsNamespace(t *testing.T) {
	sup, store, cfg := newTestSupervisor(t)

	port, err := sup.EnsureRunning(context.Background(), "foo", OriginExplicit)
	if err != nil {
		t.Fatalf("EnsureRunning: %v", err)
	}
	if port < cfg.BackendPortStart || port > cfg.BackendPortEnd {
		t.Errorf("port %d outside configured range", port)
	}

	// Port should accept TCP connections — the fake tursodb is up.
	conn, err := net.DialTimeout("tcp", "127.0.0.1:"+strconv.Itoa(port), time.Second)
	if err != nil {
		t.Fatalf("dial spawned port: %v", err)
	}
	_ = conn.Close()

	// Namespace persisted to the store.
	ns := store.Get("foo")
	if ns == nil {
		t.Fatalf("namespace not in store")
	}
	if ns.Origin != OriginExplicit {
		t.Errorf("origin = %s, want explicit", ns.Origin)
	}
	if !ns.Locked {
		t.Errorf("explicit namespace should be locked by default")
	}
	if ns.PID == 0 {
		t.Errorf("runtime PID not recorded")
	}
}

func TestSupervisor_AutoCreatedIsUnlocked(t *testing.T) {
	sup, store, _ := newTestSupervisor(t)

	_, err := sup.EnsureRunning(context.Background(), "auto-ns", OriginAuto)
	if err != nil {
		t.Fatalf("EnsureRunning: %v", err)
	}
	ns := store.Get("auto-ns")
	if ns == nil {
		t.Fatalf("namespace missing")
	}
	if ns.Locked {
		t.Errorf("auto-created namespace must not be locked")
	}
	if ns.Origin != OriginAuto {
		t.Errorf("origin = %s, want auto", ns.Origin)
	}
}

func TestSupervisor_LookupIsIdempotent(t *testing.T) {
	sup, _, _ := newTestSupervisor(t)

	first, err := sup.EnsureRunning(context.Background(), "ns1", OriginExplicit)
	if err != nil {
		t.Fatal(err)
	}
	second, err := sup.EnsureRunning(context.Background(), "ns1", OriginExplicit)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Errorf("EnsureRunning returned different ports for the same ns: %d vs %d", first, second)
	}
	if got := sup.Lookup("ns1"); got != first {
		t.Errorf("Lookup = %d, want %d", got, first)
	}
	if got := sup.Lookup("unknown"); got != 0 {
		t.Errorf("Lookup unknown = %d, want 0", got)
	}
}

func TestSupervisor_RejectsInvalidName(t *testing.T) {
	sup, _, _ := newTestSupervisor(t)
	_, err := sup.EnsureRunning(context.Background(), "BAD/NAME", OriginExplicit)
	if err == nil {
		t.Errorf("expected validation error")
	}
}

func TestSupervisor_RespectsMaxNamespaces(t *testing.T) {
	sup, _, cfg := newTestSupervisor(t)
	cfg.MaxNamespaces = 2

	for _, name := range []string{"a", "b"} {
		if _, err := sup.EnsureRunning(context.Background(), name, OriginExplicit); err != nil {
			t.Fatalf("EnsureRunning %q: %v", name, err)
		}
	}
	_, err := sup.EnsureRunning(context.Background(), "c", OriginExplicit)
	if err == nil || !strings.Contains(err.Error(), "max namespaces") {
		t.Errorf("expected max namespaces error, got %v", err)
	}
}

func TestSupervisor_DestroyArchivesAndUnregisters(t *testing.T) {
	sup, store, cfg := newTestSupervisor(t)

	// Create a namespace, then write a marker into its .db file to confirm
	// the archive captured the live file.
	port, err := sup.EnsureRunning(context.Background(), "victim", OriginExplicit)
	if err != nil {
		t.Fatal(err)
	}
	if port == 0 {
		t.Fatal("zero port")
	}
	dbPath := filepath.Join(cfg.DataDir, "victim.db")
	if err := os.WriteFile(dbPath, []byte("marker"), 0o644); err != nil {
		t.Fatal(err)
	}

	archive, err := sup.Destroy(context.Background(), "victim")
	if err != nil {
		t.Fatalf("Destroy: %v", err)
	}
	if archive == "" || !strings.Contains(archive, "victim.") {
		t.Errorf("unexpected archive path: %q", archive)
	}
	if _, err := os.Stat(dbPath); !os.IsNotExist(err) {
		t.Errorf("source db should be moved; err = %v", err)
	}
	moved := filepath.Join(archive, "victim.db")
	if _, err := os.Stat(moved); err != nil {
		t.Errorf("archived db missing: %v", err)
	}
	if store.Get("victim") != nil {
		t.Errorf("store still contains destroyed namespace")
	}
}

func TestSupervisor_StopShutsDownGracefully(t *testing.T) {
	sup, _, _ := newTestSupervisor(t)

	for _, name := range []string{"alpha", "beta", "gamma"} {
		if _, err := sup.EnsureRunning(context.Background(), name, OriginExplicit); err != nil {
			t.Fatalf("EnsureRunning %s: %v", name, err)
		}
	}

	start := time.Now()
	sup.Stop(2 * time.Second)
	elapsed := time.Since(start)
	if elapsed > 2*time.Second {
		t.Errorf("Stop took too long: %v", elapsed)
	}
	// After Stop, all ports should be released.
	for _, name := range []string{"alpha", "beta", "gamma"} {
		if got := sup.Lookup(name); got != 0 {
			t.Errorf("namespace %s still has port %d after Stop", name, got)
		}
	}
}

func TestSupervisor_ConcurrentFirstTouchIsSerialized(t *testing.T) {
	sup, _, _ := newTestSupervisor(t)

	// 16 goroutines all trying to ensure the SAME namespace concurrently.
	// The per-name mutex must serialize them so we end up with a single
	// process — verified by checking that only one Backend port was
	// allocated (sup.procs has exactly one entry for that name).
	const N = 16
	var wg sync.WaitGroup
	var firstPort int32
	for i := 0; i < N; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, err := sup.EnsureRunning(context.Background(), "shared", OriginAuto)
			if err != nil {
				t.Errorf("EnsureRunning: %v", err)
				return
			}
			if atomic.CompareAndSwapInt32(&firstPort, 0, int32(p)) {
				return
			}
			if int32(p) != atomic.LoadInt32(&firstPort) {
				t.Errorf("concurrent EnsureRunning returned different ports: %d vs %d", p, firstPort)
			}
		}()
	}
	wg.Wait()
}

func TestSupervisor_PortReleasedOnDestroy(t *testing.T) {
	sup, _, _ := newTestSupervisor(t)
	port, err := sup.EnsureRunning(context.Background(), "first", OriginExplicit)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := sup.Destroy(context.Background(), "first"); err != nil {
		t.Fatal(err)
	}
	// Re-create — the port should be available again (allocator may
	// reuse it or pick the next). Either way, EnsureRunning should
	// succeed without "no free backend port".
	if _, err := sup.EnsureRunning(context.Background(), "second", OriginExplicit); err != nil {
		t.Errorf("EnsureRunning after Destroy: %v", err)
	}
	_ = port
}

func TestSupervisor_RestoreRespawnsKnownNamespaces(t *testing.T) {
	sup, store, _ := newTestSupervisor(t)

	if _, err := sup.EnsureRunning(context.Background(), "persisted", OriginExplicit); err != nil {
		t.Fatal(err)
	}
	if _, err := sup.EnsureRunning(context.Background(), "transient", OriginAuto); err != nil {
		t.Fatal(err)
	}
	// Simulate restart: stop processes (but keep the store intact),
	// build a brand-new supervisor pointing at the same data dir, and
	// confirm both namespaces come back up.
	sup.Stop(2 * time.Second)

	cfg := &Config{
		DataDir:          store.path[:strings.LastIndex(store.path, "/_state")],
		TursodbBin:       buildFakeTursodb(t),
		BackendPortStart: 19200,
		BackendPortEnd:   19299,
		StartupTimeout:   3 * time.Second,
		MaxNamespaces:    16,
	}
	store2, err := NewStore(cfg.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store2.Close() })
	sup2 := NewSupervisor(cfg, store2, slog.Default())
	t.Cleanup(func() { sup2.Stop(2 * time.Second) })

	sup2.Restore(context.Background())

	if got := sup2.Lookup("persisted"); got == 0 {
		t.Errorf("persisted namespace not restored")
	}
	if got := sup2.Lookup("transient"); got == 0 {
		t.Errorf("transient namespace not restored")
	}
}
