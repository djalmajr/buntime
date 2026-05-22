package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// fakeTursodbServer simulates the `tursodb --sync-server` HTTP interface for
// pipeline requests. It accepts `POST /v2/pipeline` and either responds with
// success — optionally writing a snapshot file when the SQL looks like
// `VACUUM INTO '<path>'` — or returns an error response so tests can drive
// the failure paths.
type fakeTursodbServer struct {
	srv      *httptest.Server
	respond  func(sql string) (status int, body []byte)
	lastSQL  string
	lastBody []byte
}

func newFakeTursodb(t *testing.T) *fakeTursodbServer {
	t.Helper()
	f := &fakeTursodbServer{}
	// Default: take the SQL string, if it is a `VACUUM INTO '<path>'`,
	// write a tiny "snapshot" file at that path and return ok.
	f.respond = func(sql string) (int, []byte) {
		if strings.HasPrefix(strings.ToUpper(sql), "VACUUM INTO") {
			start := strings.Index(sql, "'")
			end := strings.LastIndex(sql, "'")
			if start > 0 && end > start {
				path := sql[start+1 : end]
				if err := os.WriteFile(path, []byte("snapshot:"+path), 0o644); err != nil {
					return 500, []byte(`{"results":[{"type":"error","error":{"message":"` + err.Error() + `","code":"FS"}}]}`)
				}
			}
		}
		return 200, []byte(`{"results":[{"type":"ok","response":{"type":"execute","result":{}}}]}`)
	}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/pipeline" {
			http.NotFound(w, r)
			return
		}
		body, _ := readAll(r.Body)
		f.lastBody = body
		// Extract the first execute statement's SQL for the responder.
		var req struct {
			Requests []struct {
				Stmt struct {
					SQL string `json:"sql"`
				} `json:"stmt"`
			} `json:"requests"`
		}
		_ = json.Unmarshal(body, &req)
		sql := ""
		if len(req.Requests) > 0 {
			sql = req.Requests[0].Stmt.SQL
		}
		f.lastSQL = sql
		status, body := f.respond(sql)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write(body)
	}))
	t.Cleanup(f.srv.Close)
	return f
}

// port returns the TCP port the fake server is listening on.
func (f *fakeTursodbServer) port() int {
	host := f.srv.URL[len("http://"):]
	_, p, _ := net.SplitHostPort(host)
	n, _ := strconv.Atoi(p)
	return n
}

// readAll is a small shim so we can be explicit in tests.
func readAll(r interface{ Read(p []byte) (int, error) }) ([]byte, error) {
	buf := make([]byte, 0, 1024)
	tmp := make([]byte, 512)
	for {
		n, err := r.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
		}
		if err != nil {
			if err.Error() == "EOF" {
				return buf, nil
			}
			return buf, err
		}
	}
}

func newSupervisorForBackup(t *testing.T, fake *fakeTursodbServer) (*Supervisor, string) {
	t.Helper()
	dir := t.TempDir()
	cfg := &Config{
		DataDir:          dir,
		StartupTimeout:   2 * time.Second,
		BackendPortStart: 9000,
		BackendPortEnd:   9999,
	}
	store, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	sup := NewSupervisor(cfg, store, slog.Default())
	// Inject a "running" namespace pointing at the fake server. We do not
	// spawn a real subprocess — the Backup function only needs the port
	// lookup to succeed.
	sup.procs["api-keys"] = &runningProc{port: fake.port()}
	_, _ = store.Add(&Namespace{Name: "api-keys", Origin: OriginExplicit})
	return sup, dir
}

func TestBackup_WritesSnapshotFile(t *testing.T) {
	fake := newFakeTursodb(t)
	sup, dir := newSupervisorForBackup(t, fake)

	dest := filepath.Join(dir, "_backups", "api-keys-test.db")
	if err := sup.Backup(context.Background(), "api-keys", dest); err != nil {
		t.Fatalf("Backup: %v", err)
	}

	// fake.respond writes a marker to the dest; confirm it landed.
	data, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("read snapshot: %v", err)
	}
	if !strings.Contains(string(data), "snapshot:") {
		t.Errorf("snapshot did not contain marker, got %q", string(data))
	}

	if !strings.Contains(fake.lastSQL, "VACUUM INTO") {
		t.Errorf("expected VACUUM INTO in request, got %q", fake.lastSQL)
	}
	if !strings.Contains(fake.lastSQL, dest) {
		t.Errorf("expected dest path %q in SQL, got %q", dest, fake.lastSQL)
	}
}

func TestBackup_InvalidNamespaceName(t *testing.T) {
	fake := newFakeTursodb(t)
	sup, dir := newSupervisorForBackup(t, fake)

	dest := filepath.Join(dir, "_backups", "bad.db")
	if err := sup.Backup(context.Background(), "BAD/NS", dest); err == nil {
		t.Errorf("expected error for invalid namespace name")
	}
}

func TestBackup_NamespaceNotRunning(t *testing.T) {
	fake := newFakeTursodb(t)
	sup, dir := newSupervisorForBackup(t, fake)

	dest := filepath.Join(dir, "_backups", "missing.db")
	err := sup.Backup(context.Background(), "missing", dest)
	if err == nil {
		t.Errorf("expected error for missing namespace")
	}
	if !strings.Contains(err.Error(), "not running") {
		t.Errorf("expected 'not running' in error, got %v", err)
	}
}

func TestBackup_RefusesOverwrite(t *testing.T) {
	fake := newFakeTursodb(t)
	sup, dir := newSupervisorForBackup(t, fake)

	dest := filepath.Join(dir, "_backups", "exists.db")
	_ = os.MkdirAll(filepath.Dir(dest), 0o755)
	_ = os.WriteFile(dest, []byte("existing"), 0o644)

	err := sup.Backup(context.Background(), "api-keys", dest)
	if err == nil {
		t.Errorf("expected error when destination exists")
	}
	if !strings.Contains(err.Error(), "already exists") {
		t.Errorf("expected 'already exists' in error, got %v", err)
	}
}

func TestBackup_PropagatesTursodbError(t *testing.T) {
	fake := newFakeTursodb(t)
	fake.respond = func(_ string) (int, []byte) {
		return 200, []byte(`{"results":[{"type":"error","error":{"message":"disk full","code":"FULL"}}]}`)
	}
	sup, dir := newSupervisorForBackup(t, fake)

	dest := filepath.Join(dir, "_backups", "err.db")
	err := sup.Backup(context.Background(), "api-keys", dest)
	if err == nil {
		t.Fatalf("expected error")
	}
	if !strings.Contains(err.Error(), "disk full") {
		t.Errorf("expected upstream error in message, got %v", err)
	}
}

func TestBackup_PropagatesHTTPError(t *testing.T) {
	fake := newFakeTursodb(t)
	fake.respond = func(_ string) (int, []byte) {
		return 503, []byte("service unavailable")
	}
	sup, dir := newSupervisorForBackup(t, fake)

	dest := filepath.Join(dir, "_backups", "503.db")
	err := sup.Backup(context.Background(), "api-keys", dest)
	if err == nil {
		t.Fatalf("expected error")
	}
	if !strings.Contains(err.Error(), "503") {
		t.Errorf("expected http status in message, got %v", err)
	}
}

func TestBackup_EscapesQuotesInPath(t *testing.T) {
	if escaped := escapeSQLLiteral("a'b'c"); escaped != "a''b''c" {
		t.Errorf("escapeSQLLiteral: got %q, want a''b''c", escaped)
	}
	if escaped := escapeSQLLiteral("normal/path"); escaped != "normal/path" {
		t.Errorf("escapeSQLLiteral: got %q, want normal/path", escaped)
	}
}

func TestBackupDir_LivesUnderDataDir(t *testing.T) {
	fake := newFakeTursodb(t)
	sup, dir := newSupervisorForBackup(t, fake)
	got := sup.BackupDir()
	want := filepath.Join(dir, "_backups")
	if got != want {
		t.Errorf("BackupDir = %q, want %q", got, want)
	}
}

func TestAdminBackup_StreamsAndCleansUp(t *testing.T) {
	fake := newFakeTursodb(t)
	cfg := &Config{
		DataDir:          t.TempDir(),
		StartupTimeout:   2 * time.Second,
		BackendPortStart: 9000,
		BackendPortEnd:   9999,
		AdminToken:       "",
	}
	store, err := NewStore(cfg.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	sup := NewSupervisor(cfg, store, slog.Default())
	sup.procs["api-keys"] = &runningProc{port: fake.port()}
	_, _ = store.Add(&Namespace{Name: "api-keys", Origin: OriginExplicit})

	h := AdminHandler(cfg, sup, store, slog.Default())

	r := httptest.NewRequest("GET", "/v1/namespaces/api-keys/backup", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/vnd.sqlite3" {
		t.Errorf("Content-Type = %q, want application/vnd.sqlite3", ct)
	}
	if cd := w.Header().Get("Content-Disposition"); !strings.Contains(cd, `filename="api-keys-`) {
		t.Errorf("Content-Disposition = %q; expected filename prefix", cd)
	}
	body := w.Body.String()
	if !strings.Contains(body, "snapshot:") {
		t.Errorf("body did not include snapshot marker: %q", body)
	}

	// The handler must clean up the temp file after streaming.
	entries, _ := os.ReadDir(sup.BackupDir())
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "api-keys-") {
			t.Errorf("temp file %q was not cleaned up", e.Name())
		}
	}
}

func TestAdminBackup_PropagatesError(t *testing.T) {
	fake := newFakeTursodb(t)
	fake.respond = func(_ string) (int, []byte) {
		return 200, []byte(`{"results":[{"type":"error","error":{"message":"locked","code":"BUSY"}}]}`)
	}
	cfg := &Config{
		DataDir:          t.TempDir(),
		StartupTimeout:   2 * time.Second,
		BackendPortStart: 9000,
		BackendPortEnd:   9999,
	}
	store, _ := NewStore(cfg.DataDir)
	t.Cleanup(func() { store.Close() })
	sup := NewSupervisor(cfg, store, slog.Default())
	sup.procs["api-keys"] = &runningProc{port: fake.port()}
	_, _ = store.Add(&Namespace{Name: "api-keys", Origin: OriginExplicit})

	h := AdminHandler(cfg, sup, store, slog.Default())
	r := httptest.NewRequest("GET", "/v1/namespaces/api-keys/backup", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", w.Code)
	}
}
