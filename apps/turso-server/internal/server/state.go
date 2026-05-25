package server

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// NamespaceOrigin records how a namespace came into existence. Used by the
// GC to decide eligibility (auto-created idle namespaces are sweep targets;
// explicit ones survive until their TTL or until DELETE).
type NamespaceOrigin string

const (
	OriginAuto     NamespaceOrigin = "auto"
	OriginExplicit NamespaceOrigin = "explicit"
)

// Namespace is the persistent record for a single tursodb instance. Runtime
// fields (Port, PID) are not persisted — they are reassigned on every boot
// when the supervisor respawns the backing process.
type Namespace struct {
	Name         string          `json:"name"`
	Origin       NamespaceOrigin `json:"origin"`
	CreatedAt    time.Time       `json:"createdAt"`
	LastAccessAt time.Time       `json:"lastAccessAt"`
	Locked       bool            `json:"locked"`
	TTL          string          `json:"ttl,omitempty"` // RFC 3339 duration like "30d", "12h"

	// Runtime — set by supervisor, not persisted.
	Port int `json:"-"`
	PID  int `json:"-"`
}

// stateFile is the on-disk schema. The file always contains the full list,
// rewritten atomically on every change.
type stateFile struct {
	Version    int          `json:"version"`
	Namespaces []*Namespace `json:"namespaces"`
}

const stateFileVersion = 1

// Store provides thread-safe read/write access to the namespace registry and
// persists changes to a JSON file via atomic write (write to tmp + rename).
type Store struct {
	path string

	mu          sync.RWMutex
	namespaces  map[string]*Namespace
	dirty       bool          // true if state has changed since last flush
	flushTicker *time.Ticker  // background flush for lastAccess updates
	stopCh      chan struct{} // closes the flush goroutine
}

// NewStore opens (or creates) a state file at `<dataDir>/_state/namespaces.json`
// and starts a background flusher that persists `lastAccess` updates with a
// debounce (default 60s). Returns the loaded store, ready to use.
func NewStore(dataDir string) (*Store, error) {
	stateDir := filepath.Join(dataDir, "_state")
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		return nil, fmt.Errorf("create state dir: %w", err)
	}
	path := filepath.Join(stateDir, "namespaces.json")

	s := &Store{
		path:       path,
		namespaces: make(map[string]*Namespace),
		stopCh:     make(chan struct{}),
	}

	if err := s.load(); err != nil {
		return nil, err
	}

	s.flushTicker = time.NewTicker(60 * time.Second)
	go s.flushLoop()

	return s, nil
}

// Close stops the background flusher and persists any pending changes.
func (s *Store) Close() error {
	close(s.stopCh)
	s.flushTicker.Stop()
	return s.flush()
}

func (s *Store) load() error {
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			// First boot — nothing to load.
			return nil
		}
		return fmt.Errorf("read state file: %w", err)
	}
	var sf stateFile
	if err := json.Unmarshal(data, &sf); err != nil {
		return fmt.Errorf("parse state file: %w", err)
	}
	for _, ns := range sf.Namespaces {
		if ns.Name == "" {
			continue
		}
		s.namespaces[ns.Name] = ns
	}
	return nil
}

// flush serializes the in-memory state and writes it atomically. Callers
// should not invoke this on the hot path — the background flushLoop handles
// debounced persistence; explicit lifecycle changes (create/delete) call
// flush synchronously to guarantee durability before responding to the
// client.
func (s *Store) flush() error {
	s.mu.RLock()
	if !s.dirty {
		s.mu.RUnlock()
		return nil
	}
	list := make([]*Namespace, 0, len(s.namespaces))
	for _, ns := range s.namespaces {
		// Deep-copy to avoid races with concurrent updates while marshaling.
		copy := *ns
		copy.Port = 0
		copy.PID = 0
		list = append(list, &copy)
	}
	s.mu.RUnlock()

	sf := stateFile{Version: stateFileVersion, Namespaces: list}
	data, err := json.MarshalIndent(sf, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal state: %w", err)
	}

	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return fmt.Errorf("write tmp state: %w", err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		return fmt.Errorf("rename tmp state: %w", err)
	}

	s.mu.Lock()
	s.dirty = false
	s.mu.Unlock()
	return nil
}

func (s *Store) flushLoop() {
	for {
		select {
		case <-s.stopCh:
			return
		case <-s.flushTicker.C:
			_ = s.flush() // best-effort
		}
	}
}

// Get returns the namespace record (or nil) for the given name. The returned
// pointer references the live record — callers that need to mutate fields
// should use one of the dedicated methods to ensure proper locking and
// dirty flagging.
func (s *Store) Get(name string) *Namespace {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.namespaces[name]
}

// List returns a snapshot of all namespaces. The returned slice is safe to
// iterate without locking.
func (s *Store) List() []*Namespace {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*Namespace, 0, len(s.namespaces))
	for _, ns := range s.namespaces {
		copy := *ns
		out = append(out, &copy)
	}
	return out
}

// Add registers a new namespace. If the namespace already exists, the call
// is a no-op (returns the existing record). Persists synchronously.
func (s *Store) Add(ns *Namespace) (*Namespace, error) {
	s.mu.Lock()
	if existing, ok := s.namespaces[ns.Name]; ok {
		s.mu.Unlock()
		return existing, nil
	}
	if ns.CreatedAt.IsZero() {
		ns.CreatedAt = time.Now().UTC()
	}
	if ns.LastAccessAt.IsZero() {
		ns.LastAccessAt = ns.CreatedAt
	}
	s.namespaces[ns.Name] = ns
	s.dirty = true
	s.mu.Unlock()
	return ns, s.flush()
}

// Remove deletes the namespace record. Returns the removed record (or nil)
// for callers that need to e.g. unlink files. Persists synchronously.
func (s *Store) Remove(name string) (*Namespace, error) {
	s.mu.Lock()
	ns, ok := s.namespaces[name]
	if !ok {
		s.mu.Unlock()
		return nil, nil
	}
	delete(s.namespaces, name)
	s.dirty = true
	s.mu.Unlock()
	return ns, s.flush()
}

// TouchAccess updates the lastAccessAt timestamp for the given namespace.
// Marked dirty for the background flusher (not flushed inline — too hot).
func (s *Store) TouchAccess(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ns, ok := s.namespaces[name]; ok {
		ns.LastAccessAt = time.Now().UTC()
		s.dirty = true
	}
}

// SetLock toggles the lock flag and persists synchronously.
func (s *Store) SetLock(name string, locked bool) error {
	s.mu.Lock()
	ns, ok := s.namespaces[name]
	if !ok {
		s.mu.Unlock()
		return fmt.Errorf("namespace not found: %s", name)
	}
	ns.Locked = locked
	s.dirty = true
	s.mu.Unlock()
	return s.flush()
}

// SetTTL stores an RFC-3339-style duration ("30d", "12h") on the namespace.
// Empty string clears the TTL. Persists synchronously.
func (s *Store) SetTTL(name, ttl string) error {
	s.mu.Lock()
	ns, ok := s.namespaces[name]
	if !ok {
		s.mu.Unlock()
		return fmt.Errorf("namespace not found: %s", name)
	}
	ns.TTL = ttl
	s.dirty = true
	s.mu.Unlock()
	return s.flush()
}

// SetRuntime records the live port/pid for a spawned namespace. Not
// persisted — runtime fields are zeroed on every reboot.
func (s *Store) SetRuntime(name string, port, pid int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ns, ok := s.namespaces[name]; ok {
		ns.Port = port
		ns.PID = pid
	}
}

// ParseTTL converts a duration string like "30d" or "12h" to time.Duration.
// Supports d (days), h, m, s suffixes. Returns 0 with nil error for empty
// input so callers can treat "no TTL" uniformly.
func ParseTTL(s string) (time.Duration, error) {
	if s == "" {
		return 0, nil
	}
	if len(s) > 0 && s[len(s)-1] == 'd' {
		days, err := parseLeadingInt(s[:len(s)-1])
		if err != nil {
			return 0, fmt.Errorf("invalid TTL %q: %w", s, err)
		}
		return time.Duration(days) * 24 * time.Hour, nil
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0, fmt.Errorf("invalid TTL %q: %w", s, err)
	}
	return d, nil
}

func parseLeadingInt(s string) (int, error) {
	if s == "" {
		return 0, fmt.Errorf("empty number")
	}
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, fmt.Errorf("non-digit %q", r)
		}
		n = n*10 + int(r-'0')
	}
	return n, nil
}
