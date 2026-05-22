package server

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// GC periodically inspects the namespace store and:
//   - Archives namespaces whose TTL has expired (origin = explicit or auto).
//   - Archives auto-created namespaces idle longer than `AutoIdleDuration`.
//   - Deletes archive directories older than `ArchiveRetention`.
//
// Archive means: stop the tursodb process, move the .db* files under
// `<dataDir>/archive/<name>.<timestamp>/`, remove the namespace from the
// store. The archive sweep then deletes the directory entirely once enough
// time has passed.
//
// Locked namespaces are skipped regardless of TTL — `locked=true` is the
// explicit "do not GC" flag that the operator (or app install flow) sets.
type GC struct {
	cfg   *Config
	sup   *Supervisor
	store *Store
	log   *slog.Logger
	stop  chan struct{}
	done  chan struct{}
	now   func() time.Time // mockable in tests
}

func NewGC(cfg *Config, sup *Supervisor, store *Store, log *slog.Logger) *GC {
	return &GC{
		cfg:   cfg,
		sup:   sup,
		store: store,
		log:   log,
		stop:  make(chan struct{}),
		done:  make(chan struct{}),
		now:   func() time.Time { return time.Now().UTC() },
	}
}

// Start launches the GC goroutine. Returns immediately. Stop blocks until
// the goroutine exits.
func (g *GC) Start() {
	go g.loop()
}

// Stop signals the GC loop to exit and waits for it.
func (g *GC) Stop() {
	close(g.stop)
	<-g.done
}

func (g *GC) loop() {
	defer close(g.done)
	ticker := time.NewTicker(g.cfg.GCInterval)
	defer ticker.Stop()
	// Sweep once immediately on boot to catch expired entries before they
	// receive any traffic.
	g.Sweep(context.Background())
	for {
		select {
		case <-g.stop:
			return
		case <-ticker.C:
			g.Sweep(context.Background())
		}
	}
}

// Sweep executes one GC pass. Exposed so tests can trigger sweeps without
// waiting on the ticker.
func (g *GC) Sweep(ctx context.Context) {
	now := g.now()
	for _, ns := range g.store.List() {
		if ns.Locked {
			continue
		}
		reason := g.evaluate(ns, now)
		if reason == "" {
			continue
		}
		g.log.Info("gc archive",
			slog.String("name", ns.Name),
			slog.String("reason", reason),
			slog.Time("createdAt", ns.CreatedAt),
			slog.Time("lastAccessAt", ns.LastAccessAt))
		if _, err := g.sup.Destroy(ctx, ns.Name); err != nil {
			g.log.Error("gc destroy failed",
				slog.String("name", ns.Name),
				slog.String("err", err.Error()))
		}
	}

	g.sweepArchiveDir(now)
}

// evaluate returns a non-empty reason string when the namespace is a GC
// candidate. Empty string means "keep". The caller must hold no locks.
func (g *GC) evaluate(ns *Namespace, now time.Time) string {
	if ns.TTL != "" {
		d, err := ParseTTL(ns.TTL)
		if err == nil && d > 0 && now.Sub(ns.CreatedAt) > d {
			return "ttl expired (" + ns.TTL + ")"
		}
	}
	if ns.Origin == OriginAuto && g.cfg.AutoIdleDuration > 0 {
		if now.Sub(ns.LastAccessAt) > g.cfg.AutoIdleDuration {
			return "auto-created idle > " + g.cfg.AutoIdleDuration.String()
		}
	}
	return ""
}

// sweepArchiveDir removes archive entries whose timestamp suffix is older
// than `ArchiveRetention`. Errors are logged and swallowed.
func (g *GC) sweepArchiveDir(now time.Time) {
	if g.cfg.ArchiveRetention <= 0 {
		return
	}
	dir := filepath.Join(g.cfg.DataDir, "archive")
	entries, err := os.ReadDir(dir)
	if err != nil {
		if !os.IsNotExist(err) {
			g.log.Warn("archive read failed", slog.String("err", err.Error()))
		}
		return
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		ts := parseArchiveTimestamp(e.Name())
		if ts.IsZero() {
			continue
		}
		if now.Sub(ts) <= g.cfg.ArchiveRetention {
			continue
		}
		path := filepath.Join(dir, e.Name())
		if err := os.RemoveAll(path); err != nil {
			g.log.Warn("archive delete failed",
				slog.String("path", path),
				slog.String("err", err.Error()))
			continue
		}
		g.log.Info("archive purged",
			slog.String("path", path),
			slog.Duration("age", now.Sub(ts)))
	}
}

// parseArchiveTimestamp extracts the timestamp suffix added by
// `Supervisor.Destroy`. Format: "<name>.20060102T150405Z". Returns zero
// time on any parse failure (so the entry is skipped, not deleted).
func parseArchiveTimestamp(name string) time.Time {
	// Find the last dot — the suffix is everything after it.
	idx := strings.LastIndexByte(name, '.')
	if idx < 0 {
		return time.Time{}
	}
	suffix := name[idx+1:]
	t, err := time.Parse("20060102T150405Z", suffix)
	if err != nil {
		return time.Time{}
	}
	return t
}
