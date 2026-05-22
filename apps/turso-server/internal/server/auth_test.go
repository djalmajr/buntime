package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBearerAuth_NoTokenPasses(t *testing.T) {
	called := false
	h := bearerAuth("", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	r := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if !called {
		t.Errorf("handler not invoked when token empty")
	}
	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
}

func TestBearerAuth_GoodToken(t *testing.T) {
	h := bearerAuth("secret", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer secret")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
}

func TestBearerAuth_LowercaseBearer(t *testing.T) {
	h := bearerAuth("secret", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "bearer secret")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Errorf("lowercase Bearer rejected; status = %d", w.Code)
	}
}

func TestBearerAuth_MissingHeader(t *testing.T) {
	h := bearerAuth("secret", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("handler invoked despite missing auth")
	}))
	r := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", w.Code)
	}
	if got := w.Header().Get("WWW-Authenticate"); got == "" {
		t.Errorf("WWW-Authenticate missing")
	}
}

func TestBearerAuth_WrongToken(t *testing.T) {
	h := bearerAuth("secret", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("handler invoked despite wrong token")
	}))
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer not-the-token")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", w.Code)
	}
}

func TestBearerAuth_HealthzPassesWithoutToken(t *testing.T) {
	called := false
	h := bearerAuth("secret", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	r := httptest.NewRequest("GET", "/healthz", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if !called {
		t.Errorf("/healthz must pass without auth")
	}
	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
}

func TestSplitNamespacePath(t *testing.T) {
	cases := []struct {
		in       string
		wantNS   string
		wantRest string
	}{
		{"/foo/v1/sync/pull", "foo", "/v1/sync/pull"},
		{"foo/v1/sync/pull", "foo", "/v1/sync/pull"},
		{"/foo", "foo", "/"},
		{"foo", "foo", "/"},
		{"/", "", ""},
		{"", "", ""},
		{"/foo/", "foo", "/"},
	}
	for _, tc := range cases {
		ns, rest := splitNamespacePath(tc.in)
		if ns != tc.wantNS || rest != tc.wantRest {
			t.Errorf("splitNamespacePath(%q) = (%q, %q), want (%q, %q)",
				tc.in, ns, rest, tc.wantNS, tc.wantRest)
		}
	}
}
