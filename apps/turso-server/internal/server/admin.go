package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// namespaceView is the JSON shape returned by list/get endpoints. It
// purposefully excludes runtime-internal fields (PID).
type namespaceView struct {
	Name         string          `json:"name"`
	Origin       NamespaceOrigin `json:"origin"`
	CreatedAt    time.Time       `json:"createdAt"`
	LastAccessAt time.Time       `json:"lastAccessAt"`
	Locked       bool            `json:"locked"`
	TTL          string          `json:"ttl,omitempty"`
	Port         int             `json:"port,omitempty"` // 0 when not currently running
	SizeBytes    int64           `json:"sizeBytes"`
}

func makeView(cfg *Config, ns *Namespace) namespaceView {
	v := namespaceView{
		Name:         ns.Name,
		Origin:       ns.Origin,
		CreatedAt:    ns.CreatedAt,
		LastAccessAt: ns.LastAccessAt,
		Locked:       ns.Locked,
		TTL:          ns.TTL,
		Port:         ns.Port,
	}
	if info, err := os.Stat(filepath.Join(cfg.DataDir, ns.Name+".db")); err == nil {
		v.SizeBytes = info.Size()
	}
	return v
}

// AdminHandler builds the http.Handler for the admin port. Endpoints:
//
//	GET    /healthz                          → liveness, no auth
//	GET    /v1/namespaces                    → list all
//	GET    /v1/namespaces/:name              → details
//	POST   /v1/namespaces/:name/create       → spawn + lock
//	DELETE /v1/namespaces/:name              → stop + archive
//	POST   /v1/namespaces/:name/lock         → mark locked=true
//	POST   /v1/namespaces/:name/unlock       → mark locked=false
//	POST   /v1/namespaces/:name/ttl          → set TTL from JSON body {"ttl":"30d"}
//	POST   /v1/namespaces/:name/access       → bump lastAccessAt
//
// All endpoints (except `/healthz` and `/readyz`) require the admin token.
func AdminHandler(cfg *Config, sup *Supervisor, store *Store, log *slog.Logger) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "ok")
	})
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "ok")
	})

	mux.HandleFunc("/v1/namespaces", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed", "use GET")
			return
		}
		list := store.List()
		views := make([]namespaceView, 0, len(list))
		for _, ns := range list {
			views = append(views, makeView(cfg, ns))
		}
		writeJSON(w, http.StatusOK, map[string]any{"namespaces": views})
	})

	mux.HandleFunc("/v1/namespaces/", func(w http.ResponseWriter, r *http.Request) {
		// Path shape: /v1/namespaces/<name>[/action]
		rest := strings.TrimPrefix(r.URL.Path, "/v1/namespaces/")
		if rest == "" {
			writeJSONError(w, http.StatusBadRequest, "missing namespace", "path is /v1/namespaces/:name[/action]")
			return
		}
		name, action, _ := strings.Cut(rest, "/")
		if err := ValidateNamespaceName(name); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid namespace", err.Error())
			return
		}

		switch {
		case action == "" && r.Method == http.MethodGet:
			ns := store.Get(name)
			if ns == nil {
				writeJSONError(w, http.StatusNotFound, "namespace not found", name)
				return
			}
			writeJSON(w, http.StatusOK, makeView(cfg, ns))

		case action == "" && r.Method == http.MethodDelete:
			archive, err := sup.Destroy(r.Context(), name)
			if err != nil {
				writeJSONError(w, http.StatusInternalServerError, "destroy failed", err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"name":        name,
				"archivedTo":  archive,
				"destroyedAt": time.Now().UTC(),
			})

		case action == "create" && r.Method == http.MethodPost:
			ctx, cancel := context.WithTimeout(r.Context(), cfg.StartupTimeout+time.Second)
			defer cancel()
			if _, err := sup.EnsureRunning(ctx, name, OriginExplicit); err != nil {
				writeJSONError(w, http.StatusInternalServerError, "create failed", err.Error())
				return
			}
			ns := store.Get(name)
			writeJSON(w, http.StatusCreated, makeView(cfg, ns))

		case action == "lock" && r.Method == http.MethodPost:
			if err := store.SetLock(name, true); err != nil {
				writeJSONError(w, http.StatusNotFound, "namespace not found", err.Error())
				return
			}
			writeJSON(w, http.StatusOK, makeView(cfg, store.Get(name)))

		case action == "unlock" && r.Method == http.MethodPost:
			if err := store.SetLock(name, false); err != nil {
				writeJSONError(w, http.StatusNotFound, "namespace not found", err.Error())
				return
			}
			writeJSON(w, http.StatusOK, makeView(cfg, store.Get(name)))

		case action == "ttl" && r.Method == http.MethodPost:
			var body struct {
				TTL string `json:"ttl"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
				writeJSONError(w, http.StatusBadRequest, "invalid body", err.Error())
				return
			}
			if body.TTL != "" {
				if _, err := ParseTTL(body.TTL); err != nil {
					writeJSONError(w, http.StatusBadRequest, "invalid ttl", err.Error())
					return
				}
			}
			if err := store.SetTTL(name, body.TTL); err != nil {
				writeJSONError(w, http.StatusNotFound, "namespace not found", err.Error())
				return
			}
			writeJSON(w, http.StatusOK, makeView(cfg, store.Get(name)))

		case action == "access" && r.Method == http.MethodPost:
			store.TouchAccess(name)
			writeJSON(w, http.StatusOK, makeView(cfg, store.Get(name)))

		case action == "backup" && r.Method == http.MethodGet:
			// Stream a hot snapshot of the namespace via `VACUUM INTO`.
			// This produces a consistent SQLite file even while the
			// sync-server holds an exclusive lock — VACUUM INTO runs on
			// the same connection. The file is created in `_backups/`,
			// streamed to the client, then unlinked.
			handleBackup(w, r, cfg, sup, name, log)

		default:
			writeJSONError(w, http.StatusNotFound, "unknown route", r.Method+" "+r.URL.Path)
		}
	})

	return bearerAuth(cfg.AdminToken, mux)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// handleBackup issues a `VACUUM INTO` against the running tursodb for the
// given namespace and streams the resulting `.db` snapshot to the client.
// The local file is removed after the response is flushed.
//
// Callers should pipe the response body directly to their storage layer
// (e.g. `curl ... | mc pipe local/turso-backups/...`). The
// `Content-Disposition` header carries a suggested filename including the
// namespace and a UTC timestamp.
func handleBackup(
	w http.ResponseWriter,
	r *http.Request,
	_ *Config,
	sup *Supervisor,
	name string,
	log *slog.Logger,
) {
	ts := time.Now().UTC().Format("20060102T150405Z")
	filename := name + "-" + ts + ".db"
	destPath := filepath.Join(sup.BackupDir(), filename)

	if err := sup.Backup(r.Context(), name, destPath); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "backup failed", err.Error())
		return
	}

	f, err := os.Open(destPath)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "open snapshot", err.Error())
		return
	}
	defer func() {
		_ = f.Close()
		if err := os.Remove(destPath); err != nil {
			log.Warn("snapshot cleanup failed",
				slog.String("path", destPath),
				slog.String("err", err.Error()))
		}
	}()

	stat, err := f.Stat()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "stat snapshot", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/vnd.sqlite3")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Header().Set("Content-Length", strconv.FormatInt(stat.Size(), 10))
	w.WriteHeader(http.StatusOK)
	if _, err := io.Copy(w, f); err != nil {
		log.Warn("snapshot stream failed",
			slog.String("path", destPath),
			slog.String("err", err.Error()))
	}
}
