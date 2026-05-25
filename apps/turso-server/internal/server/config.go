// Package server implements a multi-tenant supervisor for `tursodb --sync-server`.
//
// The supervisor spawns one tursodb process per logical namespace (a SQLite
// database file) and exposes them behind two HTTP listeners:
//
//   - Data port (default 8080): namespace-aware reverse proxy. Clients connect
//     using `libsql://host:8080/<namespace>` and the wrapper strips the prefix
//     before forwarding to the matching backend.
//   - Admin port (default 8081): REST API for namespace lifecycle. See
//     `admin.go` for the endpoint catalog.
//
// State (namespace metadata) is persisted to `<data-dir>/_state/namespaces.json`
// so the wrapper can respawn the right tursodb processes after a restart.
//
// The garbage collector reclaims namespaces that have been idle for longer
// than `AutoIdleDuration` (auto-created only) or that have a TTL that has
// expired. Archived databases are moved under `<data-dir>/archive/` and
// removed permanently after `ArchiveRetention`.
package server

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds every tunable knob for the wrapper. Defaults are populated by
// `Load`, env vars override defaults. The struct is read-only after Load
// returns — handlers should consult it without mutation.
type Config struct {
	// Bind addresses.
	DataAddr  string // default ":8080"
	AdminAddr string // default ":8081"

	// Filesystem.
	DataDir    string // default "/var/lib/turso"
	TursodbBin string // default "/usr/local/bin/tursodb"

	// Internal port range allocated for spawned tursodb processes.
	BackendPortStart int // default 9000
	BackendPortEnd   int // default 9999

	// Bearer tokens. Empty disables auth on that listener (dev only).
	DataToken  string
	AdminToken string

	// Namespace policy.
	MaxNamespaces      int           // default 256, 0 = unlimited
	AllowAutoProvision bool          // default true; when false, only explicit POST /create works
	StartupTimeout     time.Duration // wait for backend port to accept connections (default 5s)

	// GC behavior.
	GCInterval       time.Duration // sweep cadence (default 1h)
	AutoIdleDuration time.Duration // auto-created namespace idle threshold (default 7d)
	ArchiveRetention time.Duration // keep archived dirs for at least this long (default 30d)
}

// Load reads configuration from the environment and applies defaults.
func Load() (*Config, error) {
	cfg := &Config{
		DataAddr:           getEnvDefault("TURSO_DATA_ADDR", ":8080"),
		AdminAddr:          getEnvDefault("TURSO_ADMIN_ADDR", ":8081"),
		DataDir:            getEnvDefault("TURSO_DATA_DIR", "/var/lib/turso"),
		TursodbBin:         getEnvDefault("TURSODB_BIN", "/usr/local/bin/tursodb"),
		BackendPortStart:   getEnvInt("TURSO_BACKEND_PORT_START", 9000),
		BackendPortEnd:     getEnvInt("TURSO_BACKEND_PORT_END", 9999),
		DataToken:          os.Getenv("TURSO_AUTH_TOKEN"),
		AdminToken:         os.Getenv("TURSO_ADMIN_TOKEN"),
		MaxNamespaces:      getEnvInt("TURSO_MAX_NAMESPACES", 256),
		AllowAutoProvision: getEnvBool("TURSO_ALLOW_AUTO_PROVISION", true),
		StartupTimeout:     getEnvDuration("TURSO_STARTUP_TIMEOUT", 5*time.Second),
		GCInterval:         getEnvDuration("TURSO_GC_INTERVAL", time.Hour),
		AutoIdleDuration:   getEnvDuration("TURSO_AUTO_IDLE_DURATION", 7*24*time.Hour),
		ArchiveRetention:   getEnvDuration("TURSO_ARCHIVE_RETENTION", 30*24*time.Hour),
	}

	if cfg.BackendPortStart >= cfg.BackendPortEnd {
		return nil, fmt.Errorf("invalid backend port range: start=%d end=%d", cfg.BackendPortStart, cfg.BackendPortEnd)
	}

	if _, err := os.Stat(cfg.TursodbBin); err != nil {
		return nil, fmt.Errorf("tursodb binary not found at %q: %w", cfg.TursodbBin, err)
	}

	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data dir %q: %w", cfg.DataDir, err)
	}

	return cfg, nil
}

func getEnvDefault(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func getEnvInt(key string, def int) int {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func getEnvBool(key string, def bool) bool {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

func getEnvDuration(key string, def time.Duration) time.Duration {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return def
	}
	return d
}

// ValidateNamespaceName enforces the namespace naming policy. The constraints
// match common identifier conventions and prevent path traversal when the
// name is interpolated into filesystem paths.
func ValidateNamespaceName(name string) error {
	if name == "" {
		return errors.New("namespace name is empty")
	}
	if len(name) > 63 {
		return errors.New("namespace name longer than 63 characters")
	}
	for i, r := range name {
		ok := (r >= 'a' && r <= 'z') ||
			(r >= '0' && r <= '9') ||
			r == '-' || r == '_'
		if !ok {
			return fmt.Errorf("namespace name contains invalid character %q at position %d", r, i)
		}
		if i == 0 && (r == '-' || r == '_') {
			return errors.New("namespace name must start with [a-z0-9]")
		}
	}
	// Reserve underscore-prefixed names for internal use.
	if name[0] == '_' {
		return errors.New("namespace names with leading underscore are reserved")
	}
	return nil
}
