package api

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func testResponse(status int, body string) *http.Response {
	return &http.Response{
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
		StatusCode: status,
	}
}

func newTestClient(handler roundTripFunc) *Client {
	client := New("https://buntime.home", "master-key", true)
	client.httpClient = &http.Client{Transport: handler}
	return client
}

func TestListPluginsDiscoversRuntimeAPIPath(t *testing.T) {
	t.Parallel()

	client := newTestClient(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Path {
		case "/.well-known/buntime":
			return testResponse(http.StatusOK, `{"api":"/_/api"}`), nil
		case "/_/api/plugins":
			if got := r.Header.Get("X-API-Key"); got != "master-key" {
				t.Fatalf("expected X-API-Key master-key, got %q", got)
			}
			body, err := json.Marshal([]PluginInfo{{
				Name: "plugin-one",
				Path: "/data/plugins/plugin-one",
			}})
			if err != nil {
				t.Fatalf("Marshal() error = %v", err)
			}
			return testResponse(http.StatusOK, string(body)), nil
		default:
			return testResponse(http.StatusNotFound, ""), nil
		}
	})

	plugins, err := client.ListPlugins()
	if err != nil {
		t.Fatalf("ListPlugins() error = %v", err)
	}

	if len(plugins) != 1 {
		t.Fatalf("expected 1 plugin, got %d", len(plugins))
	}
	if plugins[0].Name != "plugin-one" {
		t.Fatalf("expected plugin-one, got %q", plugins[0].Name)
	}
	if !plugins[0].Enabled {
		t.Fatal("expected plugin with path to be marked enabled")
	}
	if len(plugins[0].Versions) != 1 || plugins[0].Versions[0] != "latest" {
		t.Fatalf("expected default latest version, got %#v", plugins[0].Versions)
	}
}

func TestGetHealthFallsBackToDefaultAPIPath(t *testing.T) {
	t.Parallel()

	client := newTestClient(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Path {
		case "/.well-known/buntime":
			return testResponse(http.StatusNotFound, ""), nil
		case "/api/health":
			return testResponse(http.StatusOK, `{"ok":true,"status":"ok","version":"test"}`), nil
		default:
			return testResponse(http.StatusNotFound, ""), nil
		}
	})

	health, err := client.GetHealth()
	if err != nil {
		t.Fatalf("GetHealth() error = %v", err)
	}
	if !health.OK || health.Version != "test" {
		t.Fatalf("unexpected health response: %#v", health)
	}
}

func TestInstallPluginUsesDiscoveredAPIPathOriginAndReload(t *testing.T) {
	t.Parallel()

	var uploadSeen bool
	var reloadSeen bool

	client := newTestClient(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Path {
		case "/.well-known/buntime":
			return testResponse(http.StatusOK, `{"api":"/_/api"}`), nil
		case "/_/api/plugins/upload":
			uploadSeen = true
			if r.Method != http.MethodPost {
				t.Fatalf("expected POST upload, got %s", r.Method)
			}
			if got := r.Header.Get("Origin"); got != "https://buntime.home" {
				t.Fatalf("expected Origin https://buntime.home, got %q", got)
			}
			if got := r.Header.Get("X-API-Key"); got != "master-key" {
				t.Fatalf("expected X-API-Key master-key, got %q", got)
			}
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Fatalf("ParseMultipartForm() error = %v", err)
			}
			if _, _, err := r.FormFile("file"); err != nil {
				t.Fatalf("expected multipart file: %v", err)
			}
			return testResponse(
				http.StatusOK,
				`{"success":true,"data":{"plugin":{"installedAt":"/data/plugins/plugin-one","name":"plugin-one","version":"1.2.3"}}}`,
			), nil
		case "/_/api/plugins/reload":
			reloadSeen = true
			if r.Method != http.MethodPost {
				t.Fatalf("expected POST reload, got %s", r.Method)
			}
			if got := r.Header.Get("Origin"); got != "https://buntime.home" {
				t.Fatalf("expected Origin https://buntime.home, got %q", got)
			}
			return testResponse(http.StatusOK, `{"ok":true,"plugins":[]}`), nil
		default:
			return testResponse(http.StatusNotFound, ""), nil
		}
	})

	archive, err := os.CreateTemp(t.TempDir(), "plugin-*.zip")
	if err != nil {
		t.Fatalf("CreateTemp() error = %v", err)
	}
	if _, err := archive.WriteString("zip-bytes"); err != nil {
		t.Fatalf("WriteString() error = %v", err)
	}
	if err := archive.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	result, err := client.InstallPlugin(archive.Name())
	if err != nil {
		t.Fatalf("InstallPlugin() error = %v", err)
	}
	if result.Name != "plugin-one" || result.Version != "1.2.3" {
		t.Fatalf("unexpected install result: %#v", result)
	}
	if !uploadSeen {
		t.Fatal("expected upload request")
	}
	if !reloadSeen {
		t.Fatal("expected reload request")
	}
}
