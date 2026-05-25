package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"time"
)

// DataHandler builds the http.Handler that serves the data port. Requests
// have the namespace as the first path segment (e.g. `/myapp/v1/sync/pull`).
// The handler:
//
//  1. Splits the path into namespace + remainder.
//  2. Looks up (or auto-creates) the backing tursodb process via the
//     supervisor.
//  3. Bumps `lastAccessAt` on the state store.
//  4. Rewrites the request URL to drop the namespace prefix and forwards it
//     to `127.0.0.1:<port>` via httputil.ReverseProxy.
//
// On lookup failure, returns `404` with a JSON error body. On unsupported
// requests (root path, reserved names), returns `400`.
func DataHandler(cfg *Config, sup *Supervisor, store *Store, log *slog.Logger) http.Handler {
	// Re-used reverse proxy instance. The Director picks the upstream
	// based on the request path (namespace prefix). One ReverseProxy
	// shared by all namespaces — Director is invoked per request.
	rp := &httputil.ReverseProxy{
		Director:  func(*http.Request) {}, // overridden below per-request
		Transport: &http.Transport{},
		ErrorLog:  nil, // captured via ErrorHandler instead
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			log.Warn("upstream error", slog.String("path", r.URL.Path), slog.String("err", err.Error()))
			writeJSONError(w, http.StatusBadGateway, "upstream error", err.Error())
		},
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "ok")
	})

	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "ok")
	})

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		ns, rest := splitNamespacePath(r.URL.Path)
		if ns == "" {
			writeJSONError(w, http.StatusBadRequest, "missing namespace", "request path must start with /<namespace>/")
			return
		}
		if err := ValidateNamespaceName(ns); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid namespace", err.Error())
			return
		}

		port := sup.Lookup(ns)
		if port == 0 {
			if !cfg.AllowAutoProvision {
				writeJSONError(w, http.StatusNotFound, "namespace not found", "auto-provisioning disabled; create via POST /v1/namespaces/"+ns+"/create on the admin API first")
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), cfg.StartupTimeout+time.Second)
			defer cancel()
			p, err := sup.EnsureRunning(ctx, ns, OriginAuto)
			if err != nil {
				log.Warn("auto-provision failed",
					slog.String("ns", ns),
					slog.String("err", err.Error()))
				writeJSONError(w, http.StatusInternalServerError, "auto-provision failed", err.Error())
				return
			}
			port = p
		}

		store.TouchAccess(ns)

		// Rewrite the request URL: keep the rest of the path, set Host
		// and Scheme so httputil can build the upstream request.
		target := &url.URL{
			Scheme: "http",
			Host:   "127.0.0.1:" + strconv.Itoa(port),
		}
		r2 := r.Clone(r.Context())
		r2.URL.Scheme = target.Scheme
		r2.URL.Host = target.Host
		r2.URL.Path = rest
		// Strip RequestURI — required by ReverseProxy to avoid the
		// "http: Request.RequestURI can't be set in client requests"
		// panic from the underlying client when in transport reuse.
		r2.RequestURI = ""

		// Preserve the original Host header — some libsql/tursodb
		// versions key off Host for routing. Defaults to "<host>:<port>".
		if r.Host != "" {
			r2.Header.Set("X-Forwarded-Host", r.Host)
		}
		r2.Host = target.Host

		rp.ServeHTTP(w, r2)
	})

	return bearerAuth(cfg.DataToken, mux)
}

// writeJSONError emits a standard error body so clients can parse the
// failure reason regardless of which layer rejected the request.
func writeJSONError(w http.ResponseWriter, status int, code, detail string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	body := struct {
		Code   string `json:"code"`
		Detail string `json:"detail"`
	}{Code: code, Detail: detail}
	_ = json.NewEncoder(w).Encode(body)
}

// dialUpstream is a small helper used by tests that need to confirm a port
// is reachable. Production code uses net/http/Transport which dials lazily.
func dialUpstream(port int, timeout time.Duration) error {
	conn, err := net.DialTimeout("tcp", "127.0.0.1:"+strconv.Itoa(port), timeout)
	if err != nil {
		return err
	}
	return conn.Close()
}

