package server

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestGC_evaluate(t *testing.T) {
	cfg := &Config{
		AutoIdleDuration: 7 * 24 * time.Hour,
	}
	g := &GC{cfg: cfg, log: slog.Default()}
	now := time.Date(2026, 5, 21, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		desc string
		ns   *Namespace
		want bool
	}{
		{
			desc: "explicit, no ttl, recent access → keep",
			ns: &Namespace{
				Name:         "a",
				Origin:       OriginExplicit,
				CreatedAt:    now.Add(-24 * time.Hour),
				LastAccessAt: now.Add(-time.Hour),
			},
			want: false,
		},
		{
			desc: "auto, recently accessed → keep",
			ns: &Namespace{
				Name:         "a",
				Origin:       OriginAuto,
				CreatedAt:    now.Add(-30 * 24 * time.Hour),
				LastAccessAt: now.Add(-3 * 24 * time.Hour),
			},
			want: false,
		},
		{
			desc: "auto, idle > 7d → archive",
			ns: &Namespace{
				Name:         "a",
				Origin:       OriginAuto,
				CreatedAt:    now.Add(-30 * 24 * time.Hour),
				LastAccessAt: now.Add(-8 * 24 * time.Hour),
			},
			want: true,
		},
		{
			desc: "explicit, ttl 1h, created 2h ago → archive",
			ns: &Namespace{
				Name:      "a",
				Origin:    OriginExplicit,
				CreatedAt: now.Add(-2 * time.Hour),
				TTL:       "1h",
			},
			want: true,
		},
		{
			desc: "explicit, ttl 30d, created 1d ago → keep",
			ns: &Namespace{
				Name:      "a",
				Origin:    OriginExplicit,
				CreatedAt: now.Add(-24 * time.Hour),
				TTL:       "30d",
			},
			want: false,
		},
		{
			desc: "explicit, invalid ttl → keep (defensive)",
			ns: &Namespace{
				Name:      "a",
				Origin:    OriginExplicit,
				CreatedAt: now.Add(-365 * 24 * time.Hour),
				TTL:       "garbage",
			},
			want: false,
		},
	}

	for _, tc := range cases {
		got := g.evaluate(tc.ns, now)
		if (got != "") != tc.want {
			t.Errorf("%s: got reason=%q (eligible=%v), want eligible=%v",
				tc.desc, got, got != "", tc.want)
		}
	}
}

func TestGC_SweepArchiveDir(t *testing.T) {
	dir := t.TempDir()
	cfg := &Config{
		DataDir:          dir,
		ArchiveRetention: 24 * time.Hour,
	}
	g := &GC{cfg: cfg, log: slog.Default()}
	archive := filepath.Join(dir, "archive")
	_ = os.MkdirAll(archive, 0o755)

	// Create one fresh and one old archive dir.
	now := time.Date(2026, 5, 21, 12, 0, 0, 0, time.UTC)
	fresh := filepath.Join(archive, "fresh."+now.Add(-1*time.Hour).Format("20060102T150405Z"))
	old := filepath.Join(archive, "old."+now.Add(-72*time.Hour).Format("20060102T150405Z"))
	_ = os.MkdirAll(fresh, 0o755)
	_ = os.MkdirAll(old, 0o755)

	g.sweepArchiveDir(now)

	if _, err := os.Stat(fresh); err != nil {
		t.Errorf("fresh archive removed unexpectedly: %v", err)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Errorf("old archive should be removed: err=%v", err)
	}
}

func TestParseArchiveTimestamp(t *testing.T) {
	cases := map[string]bool{
		"foo.20260521T120000Z": true,
		"foo.bar":              false,
		"no-suffix":            false,
		"foo.":                 false,
	}
	for name, ok := range cases {
		ts := parseArchiveTimestamp(name)
		got := !ts.IsZero()
		if got != ok {
			t.Errorf("parseArchiveTimestamp(%q): ok=%v, want %v (ts=%v)", name, got, ok, ts)
		}
	}
}
