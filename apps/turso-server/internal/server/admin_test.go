package server

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newAdminTestEnv(t *testing.T) (*Config, *Supervisor, *Store, http.Handler) {
	t.Helper()
	cfg := &Config{
		DataDir:    t.TempDir(),
		AdminToken: "",
	}
	store, err := NewStore(cfg.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	sup := NewSupervisor(cfg, store, slog.Default())
	h := AdminHandler(cfg, sup, store, slog.Default())
	return cfg, sup, store, h
}

func TestAdmin_GetEmptyList(t *testing.T) {
	_, _, _, h := newAdminTestEnv(t)
	r := httptest.NewRequest("GET", "/v1/namespaces", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var body struct {
		Namespaces []namespaceView `json:"namespaces"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if len(body.Namespaces) != 0 {
		t.Errorf("expected empty list, got %d", len(body.Namespaces))
	}
}

func TestAdmin_GetMissing(t *testing.T) {
	_, _, _, h := newAdminTestEnv(t)
	r := httptest.NewRequest("GET", "/v1/namespaces/foo", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", w.Code)
	}
}

func TestAdmin_LockUnlockTTL(t *testing.T) {
	_, _, store, h := newAdminTestEnv(t)
	_, _ = store.Add(&Namespace{Name: "foo", Origin: OriginExplicit})

	r := httptest.NewRequest("POST", "/v1/namespaces/foo/lock", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("lock status = %d, body=%s", w.Code, w.Body.String())
	}
	if !store.Get("foo").Locked {
		t.Errorf("lock did not stick")
	}

	r = httptest.NewRequest("POST", "/v1/namespaces/foo/unlock", nil)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("unlock status = %d", w.Code)
	}
	if store.Get("foo").Locked {
		t.Errorf("unlock did not stick")
	}

	body, _ := json.Marshal(map[string]any{"ttl": "30d"})
	r = httptest.NewRequest("POST", "/v1/namespaces/foo/ttl", bytes.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("ttl status = %d body=%s", w.Code, w.Body.String())
	}
	if got := store.Get("foo").TTL; got != "30d" {
		t.Errorf("ttl not stored: %q", got)
	}
}

func TestAdmin_InvalidTTL(t *testing.T) {
	_, _, store, h := newAdminTestEnv(t)
	_, _ = store.Add(&Namespace{Name: "foo", Origin: OriginExplicit})

	body, _ := json.Marshal(map[string]any{"ttl": "garbage"})
	r := httptest.NewRequest("POST", "/v1/namespaces/foo/ttl", bytes.NewReader(body))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400; body=%s", w.Code, w.Body.String())
	}
}

func TestAdmin_AuthEnforced(t *testing.T) {
	cfg := &Config{DataDir: t.TempDir(), AdminToken: "shh"}
	store, _ := NewStore(cfg.DataDir)
	t.Cleanup(func() { store.Close() })
	sup := NewSupervisor(cfg, store, slog.Default())
	h := AdminHandler(cfg, sup, store, slog.Default())

	r := httptest.NewRequest("GET", "/v1/namespaces", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", w.Code)
	}

	r = httptest.NewRequest("GET", "/v1/namespaces", nil)
	r.Header.Set("Authorization", "Bearer shh")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Errorf("authorized status = %d, want 200", w.Code)
	}
}

func TestAdmin_HealthzNoAuth(t *testing.T) {
	cfg := &Config{DataDir: t.TempDir(), AdminToken: "shh"}
	store, _ := NewStore(cfg.DataDir)
	t.Cleanup(func() { store.Close() })
	sup := NewSupervisor(cfg, store, slog.Default())
	h := AdminHandler(cfg, sup, store, slog.Default())

	r := httptest.NewRequest("GET", "/healthz", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Errorf("healthz status = %d, want 200", w.Code)
	}
}
