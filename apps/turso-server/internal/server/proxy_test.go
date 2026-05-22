package server

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

// fakeBackend stands in for a tursodb process. It accepts HTTP requests on
// a localhost port and echoes back the request path + method, so tests can
// assert that the proxy forwards correctly.
func fakeBackend(t *testing.T) (port int, stop func()) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Echo-Method", r.Method)
		w.Header().Set("X-Echo-Path", r.URL.Path)
		body, _ := io.ReadAll(r.Body)
		w.Write([]byte(r.URL.Path + "|" + string(body)))
	}))
	// httptest assigns a random port — extract it so the supervisor map
	// can be primed.
	host := srv.URL[len("http://"):]
	_, p, err := net.SplitHostPort(host)
	if err != nil {
		t.Fatalf("SplitHostPort(%q): %v", host, err)
	}
	pp, _ := strconv.Atoi(p)
	return pp, srv.Close
}

func TestDataHandler_ForwardsToNamespace(t *testing.T) {
	cfg := &Config{DataToken: "", AllowAutoProvision: false}
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	port, stop := fakeBackend(t)
	defer stop()

	sup := NewSupervisor(cfg, store, slog.Default())
	// Manually inject a "running" namespace pointing at the fake backend.
	sup.procs["myns"] = &runningProc{port: port}
	_, _ = store.Add(&Namespace{Name: "myns", Origin: OriginExplicit})

	h := DataHandler(cfg, sup, store, slog.Default())
	r := httptest.NewRequest("GET", "/myns/v1/sync/pull?cursor=42", strings.NewReader("hello"))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	if got := w.Header().Get("X-Echo-Path"); got != "/v1/sync/pull" {
		t.Errorf("backend received path %q, want /v1/sync/pull", got)
	}
	if got := w.Header().Get("X-Echo-Method"); got != "GET" {
		t.Errorf("backend received method %q, want GET", got)
	}
}

func TestDataHandler_MissingNamespace(t *testing.T) {
	cfg := &Config{DataToken: ""}
	store, _ := NewStore(t.TempDir())
	defer store.Close()
	sup := NewSupervisor(cfg, store, slog.Default())

	h := DataHandler(cfg, sup, store, slog.Default())
	r := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

func TestDataHandler_InvalidNamespaceName(t *testing.T) {
	cfg := &Config{DataToken: ""}
	store, _ := NewStore(t.TempDir())
	defer store.Close()
	sup := NewSupervisor(cfg, store, slog.Default())

	h := DataHandler(cfg, sup, store, slog.Default())
	r := httptest.NewRequest("GET", "/UPPERCASE/foo", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

func TestDataHandler_NoAutoProvisionReturns404(t *testing.T) {
	cfg := &Config{DataToken: "", AllowAutoProvision: false}
	store, _ := NewStore(t.TempDir())
	defer store.Close()
	sup := NewSupervisor(cfg, store, slog.Default())

	h := DataHandler(cfg, sup, store, slog.Default())
	r := httptest.NewRequest("GET", "/never-spawned/foo", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", w.Code)
	}
}

func TestDataHandler_HealthzNoAuth(t *testing.T) {
	cfg := &Config{DataToken: "secret"}
	store, _ := NewStore(t.TempDir())
	defer store.Close()
	sup := NewSupervisor(cfg, store, slog.Default())

	h := DataHandler(cfg, sup, store, slog.Default())
	r := httptest.NewRequest("GET", "/healthz", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Errorf("/healthz status = %d, want 200", w.Code)
	}
}

func TestDataHandler_AuthRequired(t *testing.T) {
	cfg := &Config{DataToken: "secret"}
	store, _ := NewStore(t.TempDir())
	defer store.Close()
	sup := NewSupervisor(cfg, store, slog.Default())

	h := DataHandler(cfg, sup, store, slog.Default())
	r := httptest.NewRequest("GET", "/myns/v1/sync/pull", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", w.Code)
	}
}

func TestDialUpstream_Reachable(t *testing.T) {
	port, stop := fakeBackend(t)
	defer stop()
	if err := dialUpstream(port, 200*1000*1000); err != nil {
		t.Errorf("dialUpstream: %v", err)
	}
}

func TestDialUpstream_Unreachable(t *testing.T) {
	if err := dialUpstream(1, 50*1000*1000); err == nil {
		t.Errorf("dialUpstream port 1: expected error")
	}
}

var _ = context.Background // suppress unused import lint if conf changes
