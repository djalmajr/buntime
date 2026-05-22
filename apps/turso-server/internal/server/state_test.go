package server

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStore_AddListGetRemove(t *testing.T) {
	dir := t.TempDir()
	s, err := NewStore(dir)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	defer s.Close()

	ns := &Namespace{
		Name:   "foo",
		Origin: OriginExplicit,
		Locked: true,
	}
	got, err := s.Add(ns)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if got.CreatedAt.IsZero() {
		t.Errorf("Add did not set CreatedAt")
	}

	if g := s.Get("foo"); g == nil || g.Name != "foo" {
		t.Errorf("Get returned %v, want foo", g)
	}

	list := s.List()
	if len(list) != 1 || list[0].Name != "foo" {
		t.Errorf("List = %v, want [foo]", list)
	}

	if _, err := s.Remove("foo"); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if g := s.Get("foo"); g != nil {
		t.Errorf("Get after Remove = %v, want nil", g)
	}
}

func TestStore_AddIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	s, _ := NewStore(dir)
	defer s.Close()

	first := &Namespace{Name: "foo", Origin: OriginExplicit}
	a, _ := s.Add(first)

	second := &Namespace{Name: "foo", Origin: OriginAuto}
	b, err := s.Add(second)
	if err != nil {
		t.Fatalf("Add(second): %v", err)
	}
	if a != b {
		t.Errorf("Add second time should return existing pointer, got new")
	}
	if b.Origin != OriginExplicit {
		t.Errorf("Add changed origin; want explicit, got %s", b.Origin)
	}
}

func TestStore_PersistAcrossReopen(t *testing.T) {
	dir := t.TempDir()
	s, _ := NewStore(dir)
	_, _ = s.Add(&Namespace{Name: "alpha", Origin: OriginExplicit, Locked: true})
	_, _ = s.Add(&Namespace{Name: "beta", Origin: OriginAuto})
	s.Close()

	s2, err := NewStore(dir)
	if err != nil {
		t.Fatalf("NewStore (reopen): %v", err)
	}
	defer s2.Close()

	if g := s2.Get("alpha"); g == nil || !g.Locked || g.Origin != OriginExplicit {
		t.Errorf("alpha lost on reopen: %+v", g)
	}
	if g := s2.Get("beta"); g == nil || g.Origin != OriginAuto {
		t.Errorf("beta lost on reopen: %+v", g)
	}
}

func TestStore_SetLockAndTTL(t *testing.T) {
	dir := t.TempDir()
	s, _ := NewStore(dir)
	defer s.Close()

	_, _ = s.Add(&Namespace{Name: "foo", Origin: OriginExplicit})

	if err := s.SetLock("foo", true); err != nil {
		t.Fatalf("SetLock: %v", err)
	}
	if !s.Get("foo").Locked {
		t.Errorf("SetLock did not stick")
	}

	if err := s.SetTTL("foo", "30d"); err != nil {
		t.Fatalf("SetTTL: %v", err)
	}
	if s.Get("foo").TTL != "30d" {
		t.Errorf("SetTTL did not stick")
	}

	if err := s.SetLock("does-not-exist", true); err == nil {
		t.Errorf("SetLock on missing ns should error")
	}
}

func TestStore_TouchAccess(t *testing.T) {
	dir := t.TempDir()
	s, _ := NewStore(dir)
	defer s.Close()

	ns := &Namespace{Name: "foo", Origin: OriginAuto}
	_, _ = s.Add(ns)
	original := s.Get("foo").LastAccessAt

	time.Sleep(10 * time.Millisecond)
	s.TouchAccess("foo")
	updated := s.Get("foo").LastAccessAt
	if !updated.After(original) {
		t.Errorf("TouchAccess did not advance lastAccessAt: original=%v updated=%v", original, updated)
	}
}

func TestStore_AtomicWrite(t *testing.T) {
	dir := t.TempDir()
	s, _ := NewStore(dir)
	defer s.Close()

	_, _ = s.Add(&Namespace{Name: "foo", Origin: OriginExplicit})

	path := filepath.Join(dir, "_state", "namespaces.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read state: %v", err)
	}

	var sf stateFile
	if err := json.Unmarshal(data, &sf); err != nil {
		t.Fatalf("unmarshal state: %v\n%s", err, data)
	}
	if sf.Version != stateFileVersion {
		t.Errorf("version = %d, want %d", sf.Version, stateFileVersion)
	}

	// Ensure tmp file does not linger.
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Errorf(".tmp file should not exist post-flush: err=%v", err)
	}
}

func TestParseTTL(t *testing.T) {
	cases := []struct {
		in   string
		want time.Duration
		err  bool
	}{
		{"", 0, false},
		{"30d", 30 * 24 * time.Hour, false},
		{"12h", 12 * time.Hour, false},
		{"5m", 5 * time.Minute, false},
		{"1h30m", 90 * time.Minute, false},
		{"abc", 0, true},
		{"5x", 0, true},
	}
	for _, tc := range cases {
		got, err := ParseTTL(tc.in)
		if tc.err {
			if err == nil {
				t.Errorf("ParseTTL(%q): expected error, got nil", tc.in)
			}
			continue
		}
		if err != nil {
			t.Errorf("ParseTTL(%q): unexpected error: %v", tc.in, err)
			continue
		}
		if got != tc.want {
			t.Errorf("ParseTTL(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestValidateNamespaceName(t *testing.T) {
	cases := []struct {
		name string
		ok   bool
	}{
		{"foo", true},
		{"app-todo-12345", true},
		{"api_keys", true},
		{"a", true},
		{"", false},
		{"-foo", false},
		{"_internal", false},
		{"foo/bar", false},
		{"foo bar", false},
		{"Foo", false}, // uppercase
		{string(make([]byte, 64)), false}, // too long (zero bytes are also invalid char-wise, double fail)
	}
	for _, tc := range cases {
		err := ValidateNamespaceName(tc.name)
		gotOK := err == nil
		if gotOK != tc.ok {
			t.Errorf("ValidateNamespaceName(%q) ok=%v, want %v (err=%v)", tc.name, gotOK, tc.ok, err)
		}
	}
}
